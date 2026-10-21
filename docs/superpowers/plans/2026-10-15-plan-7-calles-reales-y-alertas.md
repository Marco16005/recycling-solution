# Plan 7 — Calles reales y alertas en vivo: plan de implementación

> **Para quien ejecute:** cada tarea tiene responsable (Claude o Codex). Los pasos usan casillas (`- [ ]`). La forma de trabajo es la de los Planes 4 a 6: contratos compilables primero, cada quien en sus carpetas (AGENTS.md), revisión cruzada y `scripts/verificar-todo.sh` en verde sobre el mismo commit.

**Objetivo:** que el motor planee con distancias y tiempos por calle real (OSRM local, gratuito) y que el despachador vea en vivo qué paradas ya no llegan a su ventana.

**Arquitectura:**
- Las acciones consultan una matriz dirigida a OSRM antes de correr el motor y la guardan en la `EntradaPlan`. El motor sigue siendo puro: lee la matriz con una sola función `tramo` y aplica horas pico con un modelo continuo.
- Cada ruta guarda su modelo de tiempos.
- Una función pura proyecta cada jornada con los eventos del operador y el reloj, y produce alertas que la consulta de seguimiento entrega a la pantalla.

**Tecnología:**
- OSRM `ghcr.io/project-osrm/osrm-backend:v26.9.0-debian` (MLD) y osmium-tool;
- Next.js 16, Drizzle 0.45 y Postgres 17;
- Vitest y fast-check, Playwright;
- todo en Docker Compose.

**Especificación:** `docs/superpowers/specs/2026-10-15-plan-7-calles-reales-y-alertas-design.md` (revisión 2.1). Este plan argumenta desde ella; leer ambos.

## Restricciones globales

- **Ejecución:** todo en contenedores (`docker compose`); nada se instala en la máquina. Versiones exactas: ninguna imagen ni paquete sin versión.
- **Pureza:** `src/dominio` y `src/motor` son puros: sin red, sin `Date.now()`, sin `new Date()` sin argumentos, sin `Math.random()`.
- **Capas:** las pantallas solo llaman a `src/consultas` y `src/acciones`. Toda acción y consulta autoriza con `src/seguridad/permisos.ts` antes de leer o escribir.
- **Escrituras:** cada una va en una sola transacción con su renglón de bitácora, que guarda nombres de campos, nunca valores.
- **Textos y datos:** interfaz, nombres y comentarios en español. Solo datos sintéticos; ningún secreto en el repositorio.
- **Servicios externos:** ninguno. OSRM corre en la propia instalación. Los enlaces de navegación los abre el operador; la aplicación no los consulta.
- **OSRM:**
  - imagen `ghcr.io/project-osrm/osrm-backend:v26.9.0-debian`;
  - `--algorithm mld --max-table-size 400`;
  - `/table` con 5 s de plazo y sin reintento;
  - `/route` con 2 s por petición, 3 s en total y como máximo 4 a la vez;
  - caché de trazos de 500 entradas.
- **Mapa:**
  - extracto fechado de Geofabrik (`mexico-AAMMDD.osm.pbf`) con su `.md5`;
  - recorte con osmium a `MAPA_CAJA`;
  - identificador grabado con `--data_version`.
- **Configuración inicial:**
  - `factor_camion` 1.2, entre 1 y 3;
  - `horas_pico` `[{"inicio":"07:00","fin":"09:30","factor":1.3},{"inicio":"13:30","fin":"15:00","factor":1.15}]`;
  - `umbral_atraso_min` 15, entre 1 y 120.
- **Constantes:** máximo de puntos `LIMITE_PUNTOS = 400`; umbral de pin `UMBRAL_PIN_M = 300`.
- **Versiones:** `versionMotor` `"1.1.0"` para lo que se genere; `validarPlan` acepta `"1.0.0"` y `"1.1.0"`.
- **Coordenadas:** identidad exacta (misma latitud y misma longitud, sin redondear).
- **Producción:** `mem_limit` de OSRM `${LIMITE_MEMORIA_OSRM:-256m}`.

## Enfoque de la revisión

Cinco entradas o fallas que la especificación implica y que una persona encontraría primero. Cada una tiene su prueba en la tarea indicada.

1. **Cliente con el pin fuera de la caja del mapa** (en otro estado o con lat/lng invertidas). OSRM lo ajusta muy lejos. El plan se genera, el cliente sale en "revisa el pin" con su distancia y nada truena. *Prueba en P7-5.*
2. **Un cliente exactamente en la coordenada del patio**, o dos clientes en la misma coordenada. Comparten fila de la matriz y el tramo vale 0 km y 0 min, sin NaN ni división entre cero. *Prueba en P7-2.*
3. **Franjas de hora pico mal capturadas** (inicio igual al fin, traslapadas, fuera de 00:00–23:59, factor menor que 1). La configuración las rechaza con un mensaje claro y el motor no las acepta. *Pruebas en P7-8 y P7-2.*
4. **OSRM lento** (responde a los 6 s). La generación cae al respaldo `sin_respuesta` en unos 5 s, la ejecución (K7) se registra con `consulta_mapa_ms` y el plan muestra el aviso. *Prueba en P7-6.*
5. **Un plan `1.0.0` propuesto el día de la actualización.** Se abre, se ajusta y se valida sin errores con la fórmula anterior, y conserva `"1.0.0"`. *Pruebas en P7-2 (fixture) y P7-6 (integración).*

---

## 1. Reparto y orden

| # | Responsable | Tarea | Depende de |
|---|---|---|---|
| P7-0 | Claude (la parte de Codex reasignada el 2026-10-15 porque Codex no tenía cuota; Codex la revisa) | Contratos compilables de §2, AGENTS.md (`src/traslados`) y código de conflicto `frontera_vencida` | — |
| P7-1 | Claude | Migración `0008`, esquema, permisos y persistencia (`tiempos`, `restricciones.liberadas`, `consulta_mapa_ms`, configuración) | P7-0 |
| P7-2 | Codex | Motor: `crearTraslados`, `llegadaConHorasPico`, matriz, versiones, resumen y fixtures `1.0.0` | P7-0 |
| P7-3 | Codex | Dominio: `construirEntrada` con horas pico, `proyectarJornada` y `fronteraDeReruteo` con liberadas y frontera proyectada | P7-0; P7-2 para validar y cerrar |
| P7-4 | Claude | Infraestructura: imagen del mapa, servicio `osrm`, `preparar-mapa.sh`, mapa sintético y `docs/operacion.md` | — |
| P7-5 | Claude | `src/traslados`: matriz con respaldo, trazos y caché, contra OSRM real (mapa sintético) y un servidor falso | P7-0, P7-4 |
| P7-6 | Claude | Acciones: generar y re-rutear con matriz y `consulta_mapa_ms`, `rutasParaGuardar` (contrafactual y `tiempos`), liberadas y frontera viva | P7-1, P7-2, P7-3, P7-5 |
| P7-7 | Claude | Consultas: seguimiento con proyección y alertas; `obtenerPlan` con fuente de tiempos, pins y trazos | P7-1, P7-3, P7-5 |
| P7-8 | Claude | Configuración: acción y formulario (factor camión, horas pico, umbral) | P7-1, P7-2 (`validarFranjas`) |
| P7-9 | Codex | Pantallas: plan, seguimiento con alertas y "Liberar", y botones de navegación del operador | P7-0 (contratos); P7-6 y P7-7 para probar |
| P7-10 | Codex escribe, Claude ejecuta | e2e con OSRM y el mapa sintético; suite completa en verde | P7-4 a P7-9 |
| P7-11 | Ambos | Guía de auditoría, aviso para operadores, trazabilidad en la especificación, hoja de ruta, revisión cruzada y `verificar-todo.sh` sobre el mismo commit | todas |

Ramas y carpetas:
- Claude trabaja en `.worktrees/claude-plan-4`, que pasa a la rama `claude/plan-7`.
- Codex trabaja en `.worktrees/codex-plan-4`, en la rama `codex/plan-7`, creada desde `claude/plan-7` después de P7-0.
- El checkout principal vuelve a `main`.

## 2. Contratos (P7-0)

### 2.1 Motor (`src/motor/tipos.ts`, `src/motor/traslados.ts`)

```ts
/** Entre inicioMin y finMin los traslados avanzan a 1/factor de su velocidad libre. Sin traslapes; factor en [1, 3]. */
export interface FranjaPico { inicioMin: number; finMin: number; factor: number }

/**
 * Matriz dirigida de traslados por calle (Plan 7, §4.1). Fila = origen, columna = destino, en el orden de puntos.
 * Puntos con identidad exacta, sin repetidos. Diagonal 0; valores finitos y no negativos.
 */
export interface MatrizTraslados {
  puntos: Coordenada[];
  km: number[][];
  /** Minutos sin horas pico, ya con el factor de camión. */
  minLibres: number[][];
  /** Por punto: metros hasta la calle donde OSRM lo ajustó. */
  ajusteM: number[];
  /** Pares [origen, destino] que OSRM no resolvió y se llenaron con la fórmula. */
  aproximados: [number, number][];
  /** data_version de OSRM. */
  mapa: string;
}

// ParametrosMotor agrega:
//   horasPico?: FranjaPico[];          // ausente o [] = sin franjas (planes 1.0.0)
// EntradaPlan agrega:
//   traslados?: MatrizTraslados;       // ausente = fórmula anterior

export interface Tramo { km: number; minLibres: number }

/** Lanza ErrorTraslados si un punto no está en la matriz o las franjas no son válidas. */
export class ErrorTraslados extends Error {
  constructor(public readonly causa: "punto_faltante" | "franjas_invalidas" | "matriz_invalida") {
    super(`Traslados: ${causa}`);
    this.name = "ErrorTraslados";
  }
}

export interface Traslados {
  tramo(origen: Coordenada, destino: Coordenada): Tramo;
  /** Minuto entero de llegada saliendo en salidaMin (entero), con las horas pico de la entrada. */
  llegada(origen: Coordenada, destino: Coordenada, salidaMin: number): number;
}

/** Arma el índice coordenada → fila una sola vez por evaluación. Sin matriz: fórmula anterior. */
export function crearTraslados(entrada: EntradaPlan): Traslados;

/** §4.2: modelo continuo por franjas; sin franjas, salidaMin + Math.ceil(minLibres). */
export function llegadaConHorasPico(salidaMin: number, minLibres: number, franjas: FranjaPico[] | undefined): number;

/** null si son válidas; si no, el texto del problema. */
export function validarFranjas(franjas: FranjaPico[]): string | null;

export const VERSION_MOTOR = "1.1.0";
```

**Fórmula anterior, exacta:**
- `km = distanciaKm(a, b, factorCircuidad)`;
- `minLibres = km * 60 / velocidadKmh`, con esa expresión, sin redondear, para que `Math.ceil(minLibres)` sea idéntico a `minutosDeTraslado(km, velocidadKmh)`.

### 2.2 Dominio del plan (`src/dominio/plan/tipos.ts`)

```ts
// ConfiguracionPlan agrega (el factor de camión no: lo aplica la acción al pedir la matriz):
//   horasPico: { inicio: string; fin: string; factor: number }[];   // HH:MM
// construirEntrada copia horasPico a parametros.horasPico en minutos (no arma la matriz: eso necesita red).

export type MotivoAproximado = "sin_configurar" | "sin_respuesta" | "respuesta_invalida" | "error_osrm" | "demasiados_puntos";
export interface InfoTraslados {
  fuente: "osrm" | "aproximado";
  motivo: MotivoAproximado | null;   // null si fuente = "osrm"
  mapa: string | null;
  paresAproximados: number;
}
// VersionesPlan agrega:
//   traslados?: InfoTraslados;        // ausente en planes anteriores al Plan 7
```

### 2.3 Dominio de la operación (`src/dominio/operacion/tipos.ts` e `index.ts`)

```ts
/** Modelo de tiempos con que se planeó una ruta (Plan 7, §2.6). */
export interface TiemposRuta {
  puntos: string[];          // "patio" y los solicitudId de la ruta, en el orden del plan
  minLibres: number[][];     // dirigida, entre esos puntos
  horasPico: FranjaPico[];   // las del plan de origen; [] si no tenía
  turnoFinMin: number;
  descargaMin: number;
}
// ParadaOperacion agrega:  ventanaInicio: string; ventanaFin: string;   // HH:MM
// ViajeOperacion agrega:   tiempos: TiemposRuta | null;                 // null en rutas anteriores al Plan 7

export type TipoAlerta = "ventana_en_riesgo" | "fuera_de_turno" | "atraso";
export interface AlertaOperacion {
  tipo: TipoAlerta; rutaId: string; paradaId: string | null;   // null en fuera_de_turno y en atraso de salida
  minutos: number;                                              // cuánto se pasa (entero, ≥ 1)
  enViajeEnCurso: boolean;
}
export interface ParadaProyectada {
  paradaId: string; llegada: string; inicio: string; fin: string;   // ISO
  /** La ubicación anterior se supuso (tras una no atendida sin llegada). */
  ubicacionSupuesta: boolean;
}
export interface ViajeProyectado {
  rutaId: string; salida: string; regreso: string; finDescarga: string;
  /** Ruta sin tiempos: estimaciones desplazadas por el retraso observado. */
  aproximada: boolean;
  paradas: ParadaProyectada[];   // solo vigentes no cerradas
}
export interface ProyeccionJornada { jornadaId: string; viajes: ViajeProyectado[]; alertas: AlertaOperacion[] }

/** Pura (§4.3). turnoFinMin y descargaMin solo se usan en rutas sin tiempos. */
export function proyectarJornada(estado: EstadoJornada, opciones: {
  ahora: string; umbralAtrasoMin: number; turnoFinMin: number; descargaMin: number;
}): ProyeccionJornada;

/**
 * Frontera del re-ruteo (§4.4). La unidad con viaje en curso queda libre al fin de descarga proyectado de ese viaje.
 * liberadas: solicitudes que se pidió liberar; la función reporta en `liberadas` las que eran de esta jornada.
 * Una pedida que es de esta jornada y no es liberable (viaje en curso, cerrada, en sitio o jornada no disponible) → ok: false.
 */
export function fronteraDeReruteo(estado: EstadoJornada, disponible: boolean, ahora: string, opciones: {
  liberadas: ReadonlySet<string>; umbralAtrasoMin: number; turnoFinMin: number; descargaMin: number;
}):
  | { ok: true; congeladas: string[]; viajeEnCurso: string | null; retrasoMin: number; libreDesdeMin: number;
      admitidas: string[][]; aReubicar: string[]; liberadas: string[] }
  | { ok: false; motivo: string };
```

### 2.4 Traslados (`src/traslados/index.ts`, Claude, carpeta nueva)

```ts
export const LIMITE_PUNTOS = 400;
export const UMBRAL_PIN_M = 300;

export interface OpcionesOsrm {
  url: string | undefined;               // process.env.OSRM_URL; vacío o ausente = "sin_configurar"
  factorCamion: number;
  respaldo: { velocidadKmh: number; factorCircuidad: number };   // para celdas nulas
  fetch?: typeof fetch;                  // pruebas
  plazoMs?: number;                      // 5000
}
export interface ResultadoMatriz { matriz: MatrizTraslados | null; info: InfoTraslados; consultaMs: number | null }

/** Patio, ubicaciones de solicitudes y ubicación inicial de unidades, sin repetir (identidad exacta), en ese orden. */
export function puntosDeEntrada(entrada: EntradaPlan): Coordenada[];
export async function matrizDeTraslados(puntos: Coordenada[], opciones: OpcionesOsrm): Promise<ResultadoMatriz>;
/** Agrega la matriz a la entrada (si la hay). */
export function conTraslados(entrada: EntradaPlan, r: ResultadoMatriz): EntradaPlan;

export interface Trazo { coordenadas: [number, number][]; mapa: string | null; recto: boolean }   // [lng, lat]
export async function trazosDeViajes(viajes: Coordenada[][], opciones: {
  url: string | undefined; fetch?: typeof fetch; plazoMs?: number; totalMs?: number; concurrencia?: number;
}): Promise<Trazo[]>;
```

### 2.5 Datos, acciones y consultas (Claude)

```ts
// src/acciones/tipos.ts — CodigoConflicto agrega "frontera_vencida".
// src/datos/planes.ts — RestriccionesReruteo agrega liberadas: string[]; NuevaEjecucion agrega consultaMapaMs: number | null.
// src/acciones/plan-comun.ts — Generacion agrega consultaMapaMs: number | null.
// src/acciones/reruteo.nucleo.ts — entradaSchema: { jornadasNoDisponibles: uuid[] ≤ 50, liberadas?: uuid[] ≤ 200 } (solicitudId).

// src/consultas/operacion.nucleo.ts — SeguimientoJornada agrega:
export interface ParadaEnSeguimiento {
  paradaId: string; solicitudId: string; folio: string; cliente: string;
  ventana: { inicio: string; fin: string };            // HH:MM
  llegadaEstimada: string; llegadaProyectada: string;   // HH:MM
  enViajeEnCurso: boolean; liberable: boolean; ubicacionSupuesta: boolean;
}
//   proyeccion: { paradas: ParadaEnSeguimiento[]; alertas: AlertaOperacion[]; aproximada: boolean };
// VistaSeguimiento agrega: resumenAlertas: Record<TipoAlerta, number>.

// src/consultas/plan.nucleo.ts — VistaPlan agrega:
//   traslados: InfoTraslados | null;                                   // null = plan anterior al Plan 7
//   pinesARevisar: { clienteId: string; nombre: string; distanciaM: number }[];
// ViajeVista agrega:
//   trazo: { coordenadas: [number, number][]; recto: boolean; mapa: string | null; otroMapa: boolean };
```

## 3. Comandos

Desde `.worktrees/claude-plan-4` (o `codex-plan-4` con `-p rs-codex-plan-7`):

```bash
c() { docker compose -p rs-claude-plan-7 -f compose.yaml -f compose.test.yaml "$@"; }   # zsh no parte variables en palabras
c run --rm unit npm run tipos                                        # tipos
c run --rm unit npx vitest run --project unidad src/motor            # unidad, por carpeta o archivo
c run --rm integration npx vitest run --project integracion src/traslados
c run --rm --build e2e                                               # punta a punta
c down -v --remove-orphans                                           # limpiar
scripts/verificar-todo.sh                                            # todo, al cierre
```

En los pasos, `$C …` significa `c …`.

---

### P7-0: Contratos compilables (Claude; parte de Codex reasignada, Codex la revisa)

**Archivos:**
- Modificar:
  - `src/motor/tipos.ts` (§2.1) y `src/motor/index.ts`;
  - `src/dominio/plan/tipos.ts` (§2.2) y `src/dominio/operacion/tipos.ts` e `index.ts` (§2.3);
  - `src/acciones/tipos.ts` y `src/datos/planes.ts` (tipos de §2.5);
  - `AGENTS.md`: `src/traslados` en la fila de Claude;
  - la lista de lectura de AGENTS.md: Plan 7.
- Crear:
  - `src/motor/traslados.ts` con las firmas de §2.1;
  - `src/traslados/index.ts` con las firmas de §2.4.

**Interfaces:** produce todo §2. Las funciones nuevas lanzan `new Error("pendiente: P7-2")` (o P7-3, P7-5) hasta su tarea. Los campos nuevos son opcionales donde el código actual no los produce, para que todo compile sin cambiar comportamiento.

- [ ] **Paso 1.** Mover el checkout principal a `main` y la carpeta de Claude a `claude/plan-7`: `git -C .worktrees/claude-plan-4 switch claude/plan-7`.
- [ ] **Paso 2.** Escribir los tipos y firmas de §2 tal cual.
  - `fronteraDeReruteo` cambia de firma: el código actual se adapta pasando `{ liberadas: new Set(), umbralAtrasoMin: 15, turnoFinMin: minutosDeHora(config.turnoFin), descargaMin: config.descargaMin }` y devolviendo `liberadas: []`, sin cambiar todavía su cálculo.
  - `ParadaOperacion.ventanaInicio/ventanaFin` y `ViajeOperacion.tiempos` se llenan en `estadoDeJornada` (`src/datos/operacion.ts`): `ventana_inicio` y `ventana_fin` de la parada, y `tiempos: null` hasta P7-1.
- [ ] **Paso 3.** Correr `$C run --rm unit npm run verificar`. Esperado: tipos, lint y las 604 pruebas de unidad en verde.
- [ ] **Paso 4.** Commit: `Plan 7 P7-0: contratos compilables (motor, dominio, traslados) y frontera_vencida`, con "Parte de Codex reasignada; Codex la revisa".
- [ ] **Paso 5.** Crear la rama de Codex: `git -C .worktrees/codex-plan-4 switch -c codex/plan-7 claude/plan-7`.

### P7-1: Migración 0008 y persistencia (Claude)

**Archivos:**
- Modificar:
  - `src/datos/esquema.ts`: `configuracion`, `rutas.tiempos`, `ejecuciones_motor.consulta_mapa_ms`;
  - `src/datos/configuracion.ts`: `ConfiguracionCompleta` con `factorCamion`, `horasPico` y `umbralAtrasoMin`;
  - `src/datos/planes.ts`: `insertarRutas` con `tiempos`, `insertarEjecucion` con `consultaMapaMs`, `restricciones` con `liberadas`;
  - `src/datos/operacion.ts`: `estadoDeJornada` lee `tiempos`;
  - `infra/db/permisos.sql`: sin cambios de permisos, comprobado.
- Crear: `drizzle/0008_traslados.sql` (generada con `npm run bd:generar` en contenedor y revisada a mano).
- Pruebas: `src/datos/plan7.integracion.test.ts`.

**Interfaces:**
- Consume `TiemposRuta` y `FranjaPico`.
- Produce:
  - `NuevaRuta.tiempos: TiemposRuta | null`;
  - `NuevaEjecucion.consultaMapaMs: number | null`;
  - `ConfiguracionCompleta.{ factorCamion: number; horasPico: { inicio: string; fin: string; factor: number }[]; umbralAtrasoMin: number }`.

- [ ] **Paso 1: prueba que falla** (`src/datos/plan7.integracion.test.ts`):

```ts
it("configuración trae los valores iniciales del Plan 7 y sus CHECK los defienden", async () => {
  const c = await leerConfiguracionCompleta(bd);
  expect(c.factorCamion).toBe(1.2);
  expect(c.horasPico).toEqual([{ inicio: "07:00", fin: "09:30", factor: 1.3 }, { inicio: "13:30", fin: "15:00", factor: 1.15 }]);
  expect(c.umbralAtrasoMin).toBe(15);
  await expect(bd.execute(sql`UPDATE configuracion SET factor_camion = 0.9`)).rejects.toThrow(/configuracion_factor_camion/);
  await expect(bd.execute(sql`UPDATE configuracion SET umbral_atraso_min = 0`)).rejects.toThrow(/configuracion_umbral_atraso/);
});
it("una ruta guarda y devuelve su modelo de tiempos; las anteriores quedan en null", async () => { /* insertarRutas con tiempos → estadoDeJornada(...).viajes[0].tiempos toEqual(tiempos); una ruta insertada sin tiempos → null */ });
it("ejecuciones_motor guarda consulta_mapa_ms y rechaza negativos", async () => { /* insertarEjecucion({..., consultaMapaMs: 12.5}); UPDATE prohibido para rs_app sigue (permiso) */ });
it("rs_app sigue sin DELETE en rutas ni UPDATE/DELETE en ejecuciones_motor", async () => { /* como en plan4.integracion.test.ts */ });
```

- [ ] **Paso 2.** Correr `$C run --rm integration npx vitest run --project integracion src/datos/plan7`. Esperado: FALLA (columnas inexistentes).
- [ ] **Paso 3.** Esquema y migración:
  - `factor_camion double precision NOT NULL DEFAULT 1.2`, con `CHECK (factor_camion >= 1 AND factor_camion <= 3)`;
  - `horas_pico jsonb NOT NULL DEFAULT '[...]'`, con `CHECK (jsonb_typeof(horas_pico) = 'array')`;
  - `umbral_atraso_min smallint NOT NULL DEFAULT 15`, con `CHECK (BETWEEN 1 AND 120)`;
  - `rutas.tiempos jsonb` (nula);
  - `ejecuciones_motor.consulta_mapa_ms double precision`, con `CHECK (consulta_mapa_ms IS NULL OR consulta_mapa_ms >= 0)`.
- [ ] **Paso 4.** Persistencia: `insertarRutas`, `insertarEjecucion`, `leerConfiguracionCompleta`, `estadoDeJornada` (y `restricciones.liberadas` en `insertarPlan`/`leerPlan`, `[]` por omisión al leer planes anteriores).
- [ ] **Paso 5.** Correr la prueba del Paso 2 y `src/datos/migraciones.integracion.test.ts` (huellas). Esperado: PASA.
- [ ] **Paso 6.** Commit: `Plan 7 P7-1: migración 0008 (configuración de traslados, rutas.tiempos, consulta_mapa_ms)`.

### P7-2: Motor con matriz y horas pico (Codex)

**Archivos:**
- Modificar: `src/motor/traslados.ts`, `admision.ts`, `ajustes.ts`, `validacion.ts`, `index.ts`.
- Crear:
  - `src/motor/traslados.test.ts`;
  - `src/motor/fixtures/plan-1.0.0.json`: entrada y plan generados con el código de `main` **antes** de cambiarlo (`generarPlan(ejemplo)` de `ejemplos.test-datos.ts`);
  - `src/motor/compatibilidad.test.ts`.

**Interfaces:**
- Consume §2.1.
- Produce el comportamiento de §2.1:
  - `generarPlan` devuelve `versionMotor: "1.1.0"`;
  - `ajustarPlan` conserva la versión del plan de origen;
  - `validarPlan` acepta las dos versiones.

- [ ] **Paso 1: pruebas que fallan** (`traslados.test.ts`), con valores calculados a mano:

```ts
const pico = [{ inicioMin: 420, finMin: 570, factor: 1.3 }];   // 07:00–09:30
it.each([
  [480, 12.2, undefined, 493],   // sin franjas: 480 + ceil(12.2)
  [400, 26, pico, 428],          // 20 libres hasta 07:00; quedan 6 × 1.3 = 7.8 → 427.8 → 428
  [560, 20, pico, 583],          // (570−560)/1.3 = 7.6923 libres; quedan 12.3077 → 582.3077 → 583
  [450, 10, pico, 463],          // dentro: 10 × 1.3 = 13
  [569, 1, pico, 571],           // cruza el fin de la franja: 570.2308 → 571
  [570, 1, pico, 571],           // empieza justo al terminar la franja
  [480, 0, pico, 480],           // tramo de 0 minutos
])("llegadaConHorasPico(%d, %d) = %d", (s, m, f, esperado) => expect(llegadaConHorasPico(s, m, f)).toBe(esperado));

it("salir más tarde nunca hace llegar antes", () => fc.assert(fc.property(
  arbFranjas, fc.integer({ min: 0, max: 1400 }), fc.integer({ min: 0, max: 30 }), fc.double({ min: 0, max: 300, noNaN: true }),
  (f, s, d, m) => llegadaConHorasPico(s, m, f) <= llegadaConHorasPico(s + d, m, f))));

it("validarFranjas rechaza traslape, inicio = fin, fuera del día y factor < 1 o > 3", () => { /* cinco casos → texto no nulo; dos válidas → null */ });
it("un punto que no está en la matriz lanza ErrorTraslados punto_faltante", () => { /* ... */ });
it("patio y cliente en la misma coordenada: tramo 0 km y 0 min, sin NaN", () => { /* matriz con un solo punto compartido */ });
it("coordenadas distintas que coinciden hasta el sexto decimal no comparten fila", () => { /* 20.6200001 vs 20.6200004 */ });
```

- [ ] **Paso 2.** Correr `$C run --rm unit npx vitest run --project unidad src/motor/traslados`. Esperado: FALLA ("pendiente: P7-2").
- [ ] **Paso 3.** Implementar `llegadaConHorasPico` (referencia):

```ts
export function llegadaConHorasPico(salidaMin: number, minLibres: number, franjas: FranjaPico[] | undefined): number {
  if (!franjas || franjas.length === 0) return salidaMin + Math.ceil(minLibres);
  const orden = [...franjas].sort((a, b) => a.inicioMin - b.inicioMin);
  let t = salidaMin, restante = minLibres;
  while (restante > 0) {
    const actual = orden.find(f => f.inicioMin <= t && t < f.finMin);
    const factor = actual?.factor ?? 1;
    const limite = actual ? actual.finMin : (orden.find(f => f.inicioMin > t)?.inicioMin ?? Infinity);
    const cabe = (limite - t) / factor;           // minutos libres que caben antes del siguiente límite
    if (restante <= cabe) { t += restante * factor; restante = 0; }
    else { restante -= cabe; t = limite; }
  }
  return Math.ceil(t - 1e-9);   // tolerancia ε = 1e-9 min (§4.5 de este plan): 450 + 10 × 1.3 = 463.000000000000002 → 463
}
```

  Después, `crearTraslados`: un `Map<string, number>` con la llave `${lat}|${lng}` (identidad exacta). Sin matriz, usa la fórmula de §2.1.
- [ ] **Paso 4.** Reemplazar en `admision.ts`, `ajustes.ts` y `validacion.ts` cada `distanciaKm`/`minutosDeTraslado`:
  - el traslado de un tramo pasa a ser `const t = crearTraslados(entrada)` una vez por evaluación, con `t.tramo(origen, destino).km` y `t.llegada(origen, destino, hora)`;
  - el resumen usa `Math.ceil(t.tramo(...).minLibres)` por tramo;
  - el método actual usa `Math.ceil(minLibres(patio→c)) + Math.ceil(minLibres(c→patio))` y `km(patio→c) + km(c→patio)`;
  - no se agrega ninguna poda que suponga la desigualdad triangular.
- [ ] **Paso 5: compatibilidad** (`compatibilidad.test.ts`):
  - (a) con `matriz = matrizDeFormula(entrada)` y sin franjas, `generarPlan` da un plan igual al de la versión 1, salvo `versionMotor`, sobre los generadores de propiedades existentes;
  - (b) la fixture `1.0.0` se valida sin errores, se ajusta (`mover` y `actualizarHora`), sigue en `"1.0.0"` y se vuelve a validar;
  - (c) `validarPlan` rechaza un `"1.0.0"` cuya entrada trae `traslados` o `horasPico`;
  - (d) `validarPlan` rechaza un plan `"1.1.0"` armado con otra matriz;
  - (e) con matrices dirigidas e híbridas sin desigualdad triangular, más franjas, ventanas múltiples, viajes posteriores y admitidas, se cumplen las propiedades del Plan 3, incluida la FIFO de pospuestas.
- [ ] **Paso 6: rendimiento.** 60 solicitudes, 15 unidades, matriz completa y dos franjas: `generarPlan` en menos de 1000 ms (como la prueba actual del Plan 3).
- [ ] **Paso 7.** Correr `$C run --rm unit npm run verificar`. Esperado: todo en verde.
- [ ] **Paso 8.** Commit en `codex/plan-7` (lo hace Claude, "Autor: Codex"): `Plan 7 P7-2: motor con matriz por calle y horas pico`.

### P7-3: Entrada con horas pico, proyección y frontera (Codex)

**Archivos:**
- Modificar: `src/dominio/plan/entrada.ts` (y `entrada.test.ts`), `src/dominio/operacion/index.ts`.
- Crear: `src/dominio/operacion/proyeccion.ts` y `proyeccion.test.ts`.

**Interfaces:**
- Consume `llegadaConHorasPico` (de `@/motor`) y `TiemposRuta`.
- Produce `proyectarJornada` y la nueva `fronteraDeReruteo` (§2.3).

**Caso base de las pruebas.** Ruta patio→A→B→patio. `tiempos.puntos = ["patio","A","B"]`, con `minLibres`:
- patio→A 20, A→B 15, B→patio 25;
- A→patio 22, patio→B 30, B→A 15;
- sin franjas; turno hasta las 16:00 (960) y descarga de 20.

Estimadas:
- salida 08:00;
- A: llegada 08:20, inicio 08:20, fin 08:40, ventana 08:00–09:00;
- B: llegada 08:55, inicio 09:00, fin 09:20, ventana 09:00–10:00;
- regreso 09:45 y fin de descarga 10:05.

- [ ] **Paso 1: pruebas que fallan** (`proyeccion.test.ts`):

```ts
it("salió 08:10 y a las 08:40 no ha llegado a A: llega 08:40 (el reloj manda), B 09:15; atraso 20 en A y en B", ...);
it("a las 09:30 sin llegar a A: A en riesgo por 30 min (cierra 09:00) y B en riesgo por 5 (llegaría 10:05)", ...);
it("en servicio desde 08:20 y son las 08:50: el fin es 08:50, no 08:40; B llega 09:05", ...);
it("en sitio sin inicio a las 09:10: inicio = 09:10 (ahora), A en riesgo 10", ...);
it("A omitida y salió 08:00: va directo patio→B (30), llega 08:30, inicia 09:00", ...);
it("A no atendida sin llegada, cerrada 08:30: sale del patio (supuesto) 08:30 → B 09:00, ubicacionSupuesta", ...);
it("regresó 09:50 y a las 10:20 no termina la descarga: fin de descarga 10:20", ...);
it("segundo viaje sin salir: su salida es el fin de descarga proyectado del primero", ...);
it("fuera de turno cuando la descarga proyectada pasa de 16:00", ...);
it("ruta sin tiempos: estimaciones desplazadas por el retraso del último hito, aproximada = true", ...);
it("check_out hecho: sin alertas", ...);
it("propiedad: nada proyectado queda antes de ahora ni antes de un hito real anterior, y los reales no cambian", ...);
```

- [ ] **Paso 2.** Correr `$C run --rm unit npx vitest run --project unidad src/dominio/operacion`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar `proyectarJornada` según la especificación §4.3, con tiempos en minutos de Ciudad de México y conversión ISO en los bordes (como `fronteraDeReruteo`). El tramo es `llegadaConHorasPico(salida, tiempos.minLibres[i][j], tiempos.horasPico)` entre la ubicación conocida y el siguiente punto vigente.
- [ ] **Paso 4.** Cambiar `fronteraDeReruteo`:
  - `libreDesdeMin` = fin de descarga proyectado del viaje en curso, si la jornada está disponible;
  - aplicar liberadas: quitarlas de las admitidas, eliminar los viajes vacíos y renumerar, y pasarlas a `aReubicar`;
  - rechazar con `ok: false` una liberada del viaje en curso, cerrada, en sitio o de una jornada no disponible.

  Pruebas:
  - `[[A],[B]]` con A liberada da `[[B]]` y `aReubicar` `[A]`;
  - parcial: `[[A,C],[B]]` con C liberada da `[[A],[B]]`;
  - cada caso inválido;
  - una frontera que se mueve sola con `ahora`.
- [ ] **Paso 5.** `construirEntrada` copia `horasPico` (de HH:MM a minutos) y comprueba `validarFranjas`. Prueba: la configuración inicial da `[{420,570,1.3},{810,900,1.15}]`.
- [ ] **Paso 6.** Correr `$C run --rm unit npm run verificar`. Esperado: verde.
- [ ] **Paso 7.** Commit ("Autor: Codex"): `Plan 7 P7-3: proyección en vivo, frontera proyectada y liberadas`.

### P7-4: Infraestructura del mapa (Claude)

**Archivos:**
- Crear:
  - `infra/mapa/Dockerfile`: `FROM ghcr.io/project-osrm/osrm-backend:v26.9.0-debian`, con `apt-get install -y --no-install-recommends osmium-tool=<versión exacta> curl=<versión exacta> ca-certificates`; las versiones se fijan en el Paso 1;
  - `infra/mapa/preparar.sh`, que corre dentro de esa imagen;
  - `scripts/preparar-mapa.sh`;
  - `infra/mapa/prueba/generar-cuadricula.mjs` (Node, sin dependencias).
- Modificar:
  - `compose.yaml`: servicio `osrm` con `profiles: ["mapa"]`, volumen `mapa_datos`;
  - `compose.test.yaml`: `mapa-prueba-osm`, `mapa-prueba`, `osrm` con `profiles: !reset []` y volumen `mapa_prueba`; `integration` y `web` con `OSRM_URL: http://osrm:5000` y `depends_on: osrm: service_healthy`;
  - `compose.prod.yaml`: `osrm` con `restart` y `mem_limit`; `web` con `OSRM_URL: ${OSRM_URL:-}`;
  - `.env.example`: `OSRM_URL`, `MAPA_FECHA`, `MAPA_CAJA`, `LIMITE_MEMORIA_OSRM` y `COMPOSE_PROFILES=mapa` comentado;
  - `docs/operacion.md`: sección "Mapa de calles (OSRM)".

- [ ] **Paso 1.** Fijar las versiones de paquetes:

```bash
docker run --rm ghcr.io/project-osrm/osrm-backend:v26.9.0-debian sh -c 'apt-get update -qq && apt-cache policy osmium-tool curl | grep Candidate'
```

  Copiar las versiones exactas al Dockerfile.
- [ ] **Paso 2.** Mapa sintético. `generar-cuadricula.mjs <salida.osm>` escribe un OSM XML propio:
  - una cuadrícula de calles `residential` de doble sentido entre las latitudes 20.58 y 20.70 y las longitudes −100.34 y −100.22, con nodos cada 0.005°, que cubre el patio e2e (20.62, −100.30) y los clientes de `e2e/ayudas`;
  - la fila de latitud 20.60 con `oneway=yes` hacia el este;
  - una isla de calles desconectada entre 20.75 y 20.77;
  - nada entre 20.71 y 20.74 (zona sin calles).
- [ ] **Paso 3.** `compose.test.yaml`:
  - `mapa-prueba-osm` (imagen `dev`) genera `/mapa/prueba.osm`;
  - `mapa-prueba` (imagen de `infra/mapa`) corre `osrm-extract -p /opt/car.lua --data_version prueba-cuadricula --small-component-size 1`, después `osrm-partition` y `osrm-customize`. El `--small-component-size 1` hace que la isla cuente como componente propio y produzca celdas nulas;
  - `osrm` sirve `/mapa/prueba.osrm` con `osrm-routed --algorithm mld --max-table-size 400 --port 5000`;
  - prueba de salud `curl -sf "http://127.0.0.1:5000/nearest/v1/driving/-100.3,20.62"`.
- [ ] **Paso 4.** `scripts/preparar-mapa.sh` (producción), en contenedores e idempotente:
  1. `curl -fL "https://download.geofabrik.de/north-america/mexico-${MAPA_FECHA}.osm.pbf"` y su `.md5`; `md5sum -c`;
  2. `osmium extract -b "$MAPA_CAJA" ... -o recorte.osm.pbf`;
  3. `osrm-extract -p /opt/car.lua --data_version "geofabrik-mexico-${MAPA_FECHA} recorte ${MAPA_CAJA}"`, `osrm-partition` y `osrm-customize`, todo en el volumen `mapa_datos`.
  
  Si el archivo fechado ya no existe en Geofabrik, el script lo dice y pide elegir una fecha vigente.
- [ ] **Paso 5.** Comprobar, primero con el mapa de prueba y después con el real:

```bash
$C run --rm mapa-prueba && $C up -d osrm && $C exec osrm curl -s "http://127.0.0.1:5000/table/v1/driving/-100.3,20.62;-100.29,20.63?annotations=distance,duration"
```

  Esperado: `"code":"Ok"` y `"data_version":"prueba-cuadricula"`.
- [ ] **Paso 6.** Medir la memoria de `osrm` con el recorte real (`docker stats`) y anotarla en `docs/operacion.md`. Ajustar el supuesto de 256m.
- [ ] **Paso 7.** Commit: `Plan 7 P7-4: OSRM en contenedor, mapa fechado recortado y mapa sintético de prueba`.

### P7-5: Matriz, respaldo y trazos (`src/traslados`, Claude)

**Archivos:**
- Crear: `src/traslados/index.ts`, `src/traslados/osrm.ts` (peticiones y forma de la respuesta), `src/traslados/traslados.test.ts` (unidad, `fetch` falso), `src/traslados/traslados.integracion.test.ts` (OSRM real con el mapa sintético).

**Interfaces:** produce §2.4. Consume `MatrizTraslados`, `InfoTraslados`, `distanciaKm` y `EntradaPlan`.

- [ ] **Paso 1: pruebas de unidad que fallan:**
  - sin URL → `{ matriz: null, info: { fuente: "aproximado", motivo: "sin_configurar" }, consultaMs: null }`;
  - 401 puntos → `demasiados_puntos` sin hacer petición;
  - `fetch` que tarda 6 s → `sin_respuesta` en ≤ 5.5 s (con temporizador falso);
  - cuerpo no JSON o sin `durations` → `respuesta_invalida`;
  - `{"code":"NoSegment"}` → `error_osrm`;
  - celda `null` → llenada con la fórmula, en `aproximados`, y `paresAproximados` = 1;
  - `minLibres = duration/60 × factorCamion` y `km = distance/1000`;
  - `ajusteM` sale de `sources[i].distance`;
  - `puntosDeEntrada` no repite coordenadas idénticas y conserva distintas las que difieren en el séptimo decimal.
- [ ] **Paso 2.** Correr `$C run --rm unit npx vitest run --project unidad src/traslados`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar:
  - `/table/v1/driving/{lng,lat;...}?annotations=distance,duration` con `AbortSignal.timeout(plazoMs)`;
  - comprobar la forma: `code === "Ok"`, matrices n×n de números o null, y `data_version`;
  - `consultaMs` medido con `performance.now()`.
- [ ] **Paso 4: pruebas de integración** (OSRM real):
  - la distancia entre dos nodos de la cuadrícula coincide con la suma de segmentos (haversine de la cuadrícula) con 2 % de tolerancia;
  - en la fila de sentido único, A→B (este) < B→A;
  - un punto de la isla contra uno de la cuadrícula da pares aproximados;
  - el pin en la zona sin calles (20.725, −100.28) tiene `ajusteM > UMBRAL_PIN_M`;
  - un pin fuera de la caja (19.43, −99.13) se ajusta lejos y no lanza (enfoque 1);
  - `mapa === "prueba-cuadricula"`.
- [ ] **Paso 5.** `trazosDeViajes`:
  - una petición `/route/v1/driving/...?overview=simplified&geometries=geojson` por viaje, con como máximo 4 a la vez, 2 s cada una y 3 s en total;
  - caché `Map` LRU de 500 entradas con llave `data_version|car|coordenadas`;
  - si falla o no alcanza el tiempo, el viaje se dibuja recto (`recto: true`) con los puntos en orden.

  Pruebas: un servidor falso que nunca responde deja todo recto en ≤ 3.5 s; con OSRM real, la geometría empieza y termina cerca de los puntos; la segunda llamada sale de la caché.
- [ ] **Paso 6.** Correr las pruebas de unidad y de integración de `src/traslados`. Esperado: PASA.
- [ ] **Paso 7.** Commit: `Plan 7 P7-5: matriz por calle con respaldo por motivo, pins lejanos y trazos con caché`.

### P7-6: Acciones (Claude)

**Archivos:**
- Modificar:
  - `src/acciones/plan.nucleo.ts`: generar con matriz;
  - `src/acciones/reruteo.nucleo.ts`: matriz, `liberadas`, `aReubicar` de todas y frontera viva en `validarReruteo`;
  - `src/acciones/plan-comun.ts`: `Generacion.consultaMapaMs`, `ejecutarYGuardar`, `rutasParaGuardar` (contrafactual con la matriz y `tiempos` por ruta);
  - `src/acciones/operacion.ts`: el envoltorio de servidor de `generarReruteo` acepta `liberadas`.
- Pruebas: `src/acciones/plan7.integracion.test.ts` y las existentes de los Planes 4 y 5.

**Interfaces:** consume `matrizDeTraslados`, `puntosDeEntrada`, `conTraslados`, `crearTraslados`, `fronteraDeReruteo` (nueva) y `estadoDeJornada` (con `tiempos`).

- [ ] **Paso 1: pruebas de integración que fallan** (OSRM real con el mapa sintético; `OSRM_URL` vacío para los respaldos):

```ts
it("generar con OSRM guarda la matriz en la entrada, versiones.traslados fuente osrm y K7 con consulta_mapa_ms", ...);
it("con OSRM lento (servidor falso a 6 s) el plan sale aproximado sin_respuesta y K7 se registra igual", ...);  // enfoque 4
it("validar un plan guardado sin matriz (versión 1.0.0, insertado como antes del Plan 7) funciona y conserva la versión", ...); // enfoque 5
it("rutasParaGuardar: kmContrafactual = km(patio→c) + km(c→patio) de la matriz; tiempos con submatriz, horas pico, turno y descarga", ...);
it("liberar una parada de viaje futuro la reubica en FIFO; liberar una del viaje en curso es invalido", ...);
it("las pendientes de una jornada no disponible se reubican también desde el viaje en curso (regla del Plan 5)", ...);
it("frontera_vencida: generado a las 10:00, la unidad no registra llegada; a las 10:30 su fin proyectado pasa la salida propuesta", ...);
it("re-ruteo encadenado con liberadas: el segundo parte de lo vigente en todas las rutas", ...);
```

- [ ] **Paso 2.** Correr `$C run --rm integration npx vitest run --project integracion src/acciones/plan7`. Esperado: FALLA.
- [ ] **Paso 3.** Generar: leer la instantánea; `matrizDeTraslados(puntosDeEntrada(entrada), { url: process.env.OSRM_URL, factorCamion: config.factorCamion, respaldo })`; `conTraslados`; `versiones.traslados = r.info`; `consultaMapaMs = r.consultaMs`. Todo fuera de transacción, antes de `ejecutarYGuardar`, sin cambiar cómo se mide `duracion_ms`.
- [ ] **Paso 4.** `rutasParaGuardar`:
  - con `const t = crearTraslados(entrada)`, `kmContrafactual = t.tramo(patio, s).km + t.tramo(s, patio).km`;
  - `tiempos.puntos = ["patio", ...ids del viaje]`, `minLibres[i][j] = t.tramo(punto_i, punto_j).minLibres`;
  - `horasPico = entrada.parametros.horasPico ?? []`, `turnoFinMin` y `descargaMin` de los parámetros.
- [ ] **Paso 5.** Re-ruteo:
  - `liberadas` del esquema van a cada `fronteraDeReruteo`;
  - una pedida que ninguna jornada reporta como suya, o que la frontera rechaza, es `invalido({ liberadas: ["…"] })`;
  - `aReubicar` se junta de todas las jornadas;
  - `restricciones.liberadas` se guarda;
  - matriz igual que al generar.
- [ ] **Paso 6.** `validarReruteo`: después de los bloqueos, por cada jornada disponible con viaje en el resultado, `fronteraDeReruteo(estadoBloqueado, true, ctx.reloj().toISOString(), …)`. Si `minutoDeSalidaDelPrimerViaje < Math.ceil(libreDesdeMin)`, el resultado es `conflicto("frontera_vencida", "La unidad <placa> terminará su viaje más tarde de lo previsto; vuelve a generar el re-ruteo")`.
- [ ] **Paso 7.** Correr las pruebas de integración de `src/acciones` (Planes 4, 5 y 7) y `npm run verificar`. Esperado: verde.
- [ ] **Paso 8.** Commit: `Plan 7 P7-6: generar y re-rutear con calles reales, liberadas y frontera viva`.

### P7-7: Consultas (Claude)

**Archivos:**
- Modificar: `src/consultas/operacion.nucleo.ts` (proyección y alertas), `src/consultas/plan.nucleo.ts` (`traslados`, `pinesARevisar` y `trazo`).
- Pruebas: `src/consultas/plan7.integracion.test.ts`.

**Interfaces:** produce §2.5 (`ParadaEnSeguimiento`, `resumenAlertas`, `VistaPlan.traslados`, `pinesARevisar`, `ViajeVista.trazo`).

- [ ] **Paso 1: pruebas que fallan:**
  - con reloj controlado, una jornada sin eventos no tiene alertas a las 08:00 y sí `atraso` a las 08:40 (dos llamadas con distinto `ctx.ahora`);
  - `liberable` solo en viajes futuros de jornadas disponibles;
  - `pinesARevisar` lista el cliente del pin lejano con su distancia redondeada;
  - un plan sin `versiones.traslados` da `traslados: null` y trazos rectos;
  - con OSRM apagado, `obtenerPlan` responde en ≤ 3.5 s con `recto: true`;
  - `otroMapa: true` cuando el `mapa` del trazo difiere del del plan.
- [ ] **Paso 2.** Correr `$C run --rm integration npx vitest run --project integracion src/consultas/plan7`. Esperado: FALLA.
- [ ] **Paso 3.** `seguimiento`:
  - por jornada, `proyectarJornada(estado, { ahora: ctx.ahora.toISOString(), umbralAtrasoMin: config.umbralAtrasoMin, turnoFinMin, descargaMin })`;
  - armar `ParadaEnSeguimiento` con folio y cliente de las paradas;
  - `liberable` = pendiente, vigente, de un viaje que no ha salido y de una jornada sin check-out;
  - sumar `resumenAlertas`.
- [ ] **Paso 4.** `obtenerPlan`: `traslados = plan.versiones.traslados ?? null`; pins desde `entrada.traslados.ajusteM` (punto → cliente por coordenada exacta); `trazosDeViajes` de los viajes con sus coordenadas (patio, paradas, patio).
- [ ] **Paso 5.** Correr las pruebas. Esperado: PASA.
- [ ] **Paso 6.** Commit: `Plan 7 P7-7: seguimiento con proyección y alertas; plan con fuente de tiempos, pins y trazos`.

### P7-8: Configuración (Claude)

**Archivos:**
- Modificar: `src/acciones/configuracion.nucleo.ts` (esquema Zod y campos de bitácora), `src/consultas/configuracion.nucleo.ts`, `src/components/admin/formulario-configuracion.tsx`.
- Pruebas: `src/acciones/configuracion.nucleo.test.ts`.

**Esquema:**
- `factorCamion: z.number().min(1).max(3)`;
- `umbralAtrasoMin: z.number().int().min(1).max(120)`;
- `horasPico: z.array(z.object({ inicio: hhmm, fin: hhmm, factor: z.number().min(1).max(3) })).max(6)`, con un `refine` que usa `validarFranjas` (inicio < fin y sin traslapes).

- [ ] **Paso 1: pruebas que fallan.** Rechaza traslape, inicio igual a fin, "24:00", factor 0.9 y siete franjas, con mensajes "Las franjas de hora pico no deben encimarse", "Cada franja debe terminar después de empezar", etc. (enfoque 3). Acepta los valores iniciales. La bitácora guarda `["factorCamion","horasPico","umbralAtrasoMin"]` sin valores.
- [ ] **Paso 2.** Correr `$C run --rm unit npx vitest run --project unidad src/acciones/configuracion`. Esperado: FALLA.
- [ ] **Paso 3.** Implementar.
  - Formulario: campos "Factor de camión (tiempos de auto × factor)", "Umbral de atraso (min)" y una tabla de franjas con Inicio, Fin, Factor, "Quitar" y "Agregar franja".
  - Nota: "Valores supuestos hasta calibrarlos en el piloto".
  - Los campos de velocidad y circuidad pasan a llamarse "(respaldo sin mapa)".
- [ ] **Paso 4.** Correr las pruebas y `npm run verificar`. Esperado: verde.
- [ ] **Paso 5.** Commit: `Plan 7 P7-8: configuración de factor de camión, horas pico y umbral de atraso`.

### P7-9: Pantallas (Codex)

**Archivos:** modificar `src/components/plan/*` (insignia de tiempos, pins, mapa con trazos, seguimiento con alertas y "Liberar") y `src/components/operador/mi-ruta.tsx` (botones de navegación).

**Nombres accesibles** (los usa el e2e):
- insignia: texto que empieza con "Tiempos por calle" o con "Tiempos aproximados";
- región "Pins por revisar";
- en el seguimiento:
  - región "Alertas" con el texto "N paradas en riesgo";
  - cada alerta es un `listitem` con "En riesgo", "Fuera de turno" o "Atraso" y "viaje en curso" o "viaje futuro";
  - checkbox "Liberar <folio>";
- operador: enlaces "Navegar con Waze" y "Navegar con Google Maps" de 48 px como mínimo, con `href` exactamente como en la especificación §7.

- [ ] **Paso 1.** Plan: la insignia y la lista de pins, y los trazos en el mapa (`trazo.coordenadas` como `LineString`; recto si `recto`; leyenda "dibujado con otro mapa" si `otroMapa`).
- [ ] **Paso 2.** Seguimiento:
  - hora proyectada junto a la estimada;
  - resumen y lista de alertas;
  - "ubicación supuesta" y "proyección aproximada";
  - casillas "Liberar" en el formulario de re-ruteo, que envía `liberadas`.
- [ ] **Paso 3.** Operador: los dos enlaces junto a "Abrir mapa".
- [ ] **Paso 4.** Correr `npm run verificar` en contenedor. Esperado: verde. Revisar el tamaño de teléfono (Pixel 7) del operador.
- [ ] **Paso 5.** Commit ("Autor: Codex"): `Plan 7 P7-9: pantallas de tiempos por calle, alertas, liberar y navegación`.

### P7-10: Punta a punta (Codex escribe, Claude ejecuta)

**Archivos:** crear `e2e/calles.spec.ts`; Claude agrega en `e2e/ayudas/` las ayudas que haga falta (por ejemplo `retrasarJornada`, que registra una salida sin llegada y adelanta la hora vista).

- [ ] **Paso 1.** Escribir las pruebas:
  - (a) generar el plan del día muestra "Tiempos por calle";
  - (b) el operador sale y no llega; con la hora avanzada (ayuda de Claude), el seguimiento del despachador muestra "En riesgo";
  - (c) un escenario donde la otra unidad es la única factible para una parada de viaje futuro: "Liberar <folio>", generar el re-ruteo y validar la mueven ahí, y el orden por registro se respeta;
  - (d) el operador ve "Navegar con Waze" y "Navegar con Google Maps" con su `href`.
- [ ] **Paso 2.** Correr la suite completa con `osrm`: `$C run --rm --build e2e`. Esperado: las 30 pruebas anteriores y las nuevas en verde. Las anteriores que dependían de horas calculadas con la fórmula se corrigen en su archivo, por su responsable.
- [ ] **Paso 3.** Commit ("Autor: Codex"): `Plan 7 P7-10: e2e de calles reales, alertas y liberar`.

### P7-11: Documentación, revisión cruzada y cierre (Ambos)

**Archivos:**
- `docs/guia-de-auditoria.md` (Claude), invariantes nuevas:
  - 27: un plan guarda la matriz y la fuente con que se planeó, y validar no consulta OSRM;
  - 28: nada proyectado queda antes de `ahora` ni de un hito real;
  - 29: solo se liberan paradas pendientes de viajes futuros de jornadas disponibles;
  - 24 actualizada.
- `docs/legal/` (Claude): enlaces de navegación en el aviso para operadores y en el procedimiento interno, marcado para el abogado.
- Especificación del piloto §8 y §16 (trazabilidad); `docs/README.md`; hoja de ruta.

- [ ] **Paso 1.** Documentación (Claude).
- [ ] **Paso 2.** Revisión cruzada:
  - Codex revisa P7-0, P7-1 y P7-4 a P7-8;
  - Claude revisa P7-2, P7-3, P7-9 y P7-10;
  - formato de hallazgo de la guía.
- [ ] **Paso 3.** Correr `scripts/verificar-todo.sh` sobre el mismo commit. Esperado: "Verificación completa: todo en verde.".
- [ ] **Paso 4.** Veredicto de ambos; merge `--no-ff` a `main`; etiqueta `plan-7-validado`. No se sube a ningún remoto sin preguntar.

## 4. Respuesta a la revisión del plan por Codex (2026-10-16)

Codex revisó el diseño 2.1 y este plan contra el código. Confirmó R2-1 y las cuentas a mano de `llegadaConHorasPico` y de la proyección. Sus 8 hallazgos quedan resueltos así; mandan sobre el texto de las tareas.

| # | Hallazgo | Resolución |
|---|---|---|
| 1 | Liberaciones encadenadas: una jornada vieja puede tener la misma solicitud como `reasignada` histórica y rechazar una liberación válida | P7-6: la acción resuelve primero la parada **vigente** de cada `solicitudId` liberada y entrega a cada `fronteraDeReruteo` solo las de su jornada. P7-3: la frontera solo considera paradas vigentes para liberar e ignora las históricas. Prueba en P7-6: re-ruteo encadenado donde la solicitud liberada estuvo antes `reasignada` en otra jornada |
| 2 | Rutas sin `tiempos`: desplazar por el retraso no acota cada hito por `ahora` | P7-3: en rutas sin `tiempos`, los tramos son las diferencias entre estimaciones consecutivas (salida→llegada, inicio→fin, etc.). Se encadenan desde el último hito real y cada hito pendiente queda en `max(encadenado, ahora)`. Prueba: ruta antigua con salida puntual, sin llegadas y el reloj después del fin estimado de descarga |
| 3 | Precisión: los eventos traen segundos | P7-3: los hitos reales se convierten a minutos fraccionarios de Ciudad de México (con segundos y milisegundos) y se conservan intactos en la salida. La salida de cada tramo proyectado es `Math.ceil(minuto fraccionario)`, así que nunca se proyecta antes. Los minutos pueden pasar de 1440 tras medianoche. Pruebas: salida 08:00:30 con tramo de 20 da llegada 08:21; milisegundos; cruce de medianoche |
| 4 | Caché de trazos sin invalidación al cambiar el mapa | P7-5: `trazosDeViajes` guarda la versión vigente aprendida de la última respuesta de OSRM. Si tiene más de 60 s, la renueva con `/nearest` (1 s de plazo) antes de usar la caché. La llave es `versión|car|coordenadas`. Si la sonda falla, no se usa la caché y se dibuja recto. Prueba: un servidor falso cambia `data_version` y, pasados los 60 s (reloj falso), deja de dar el trazo viejo |
| 5 | `liberable` en pantalla contra lo que acepta la acción | P7-7: `liberable` usa los mismos criterios que `generarReruteo`: jornada sin check-out, unidad y operador disponibles en el catálogo y parada pendiente vigente de un viaje que no ha salido. P7-9: al marcar una jornada como no disponible en el formulario, sus casillas "Liberar" se desmarcan y deshabilitan |
| 6 | El redondeo de referencia `Math.round(t × 1e6)` adelanta tramos diminutos | P7-2: `Math.ceil(t − 1e-9)` con tolerancia formal ε = 1e-9 min. Pruebas nuevas: `[480, 0.0000001, pico, 481]` y `[450, 10, pico, 463]` |
| 7 | Dependencias de `validarFranjas` y `llegadaConHorasPico` | §1: P7-3 y P7-8 dependen de P7-2 para validar y cerrar |
| 8 | `$C` no se parte en palabras en zsh | §3: función `c()` |
