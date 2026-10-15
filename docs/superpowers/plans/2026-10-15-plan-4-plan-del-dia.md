# Plan 4 — Plan del día

- **Fecha:** 2026-10-15.
- **Revisión:** 3. La revisión 2 incorporó los 12 hallazgos de Codex sobre el borrador (§8). La revisión 3 incorpora sus 7 hallazgos sobre la revisión 2 (§9).
- **Especificación:**
  - §5: flujo del día;
  - §6: contrato de captura;
  - §7: reglas 4 a 7;
  - §8: motor;
  - §11: K1, K4, K6 y K7;
  - §14: decisiones 2 a 6.
- **Base:** `claude/plan-2`, con los Planes 2 y 3 integrados.
- **Ejecutan:** Claude y Codex. El reparto está en §6.

## 1. Objetivo y aceptación

1. **Generar.** Con las jornadas del día armadas y solicitudes listas, el despachador pulsa **Generar plan**. El sistema toma una instantánea coherente de los datos, ejecuta el motor y guarda la propuesta con las versiones de todo lo que usó. Cada ejecución del motor queda registrada (K7), incluso si falla o si no se pudo guardar el plan.
2. **Revisar.** La pantalla muestra:
   - el plan por unidad: viajes, paradas en orden, horas estimadas, espera, carga y km;
   - un mapa con las rutas;
   - las pospuestas con su motivo y su diagnóstico;
   - el comparativo simulado contra un viaje por cliente.
3. **Ajustar.** El despachador puede mover una solicitud a otra posición, otro viaje u otra unidad, incluso una pospuesta. También puede posponerla a mano. Cada ajuste se recalcula con las reglas del motor:
   - si deja de ser factible, se rechaza con el motivo;
   - si es factible, queda en el historial del plan y en la bitácora.
4. **Validar.** En una transacción, el sistema:
   - vuelve a comprobar que nada de lo que sustentó la propuesta cambió (versiones de solicitudes, clientes, jornadas, unidades, operadores y configuración);
   - vuelve a comprobar la habilitación de los clientes (incluida la privacidad), la disponibilidad, las capacidades del catálogo y que ninguna solicitud tenga otra asignación vigente;
   - comprueba que, con la hora actual, ninguna salida quedó en el pasado. Si quedó, el despachador pulsa **Actualizar horarios** (un ajuste que recalcula las mismas secuencias desde ahora), revisa y valida;
   - escribe rutas y paradas vigentes, pasa las ruteadas a `programada` y las pospuestas al siguiente día de operación.

   Si dos validaciones simultáneas comparten solicitudes, una gana y la otra recibe el motivo, sin dejar nada a medias.
5. **Descartar** una propuesta no toca las solicitudes.
6. **K6.** Se guardan la generación, el inicio efectivo de la revisión (el primer acto del despachador, nunca una lectura de gerencia) y la validación.
7. **Requisitos de acceso.** Antes de validar, el despachador confirma que cada operador asignado tiene la inducción de seguridad de los clientes de su ruta que la exigen (catálogo de documentos). La confirmación queda guardada.
8. **Cola.** La cola de solicitudes muestra las programadas en su fecha de operación, aunque se hayan solicitado otro día.
9. **Verificación.** `scripts/verificar-todo.sh` en verde, con:
   - pruebas de unidad del motor y de la conversión;
   - pruebas de integración: concurrencia de validación en sus cuatro combinaciones, permisos y reversión;
   - prueba punta a punta: generar, ajustar, confirmar y validar.

## 2. Modelo de datos (Claude, migración `0005`)

**Idea central:** mientras el plan está propuesto, la única fuente de verdad es su JSON (`planes.resultado`). Las tablas `rutas` y `paradas` se escriben **solo al validar**, a partir del JSON ya comprobado. Así:

- los ajustes no tienen que sincronizar renglones;
- no hace falta borrar nada;
- una propuesta descartada nunca tuvo paradas vigentes.

| Tabla | Columnas |
|---|---|
| `solicitudes` | `estado` agrega `programada` y `en_ruta` (este último lo usa el Plan 5) |
| `ejecuciones_motor` | `id`, `fecha` (del plan), `inicio_en`, `fin_en`, `duracion_ms`, `resultado` (`ok` \| `error` \| `tiempo_agotado`), `error` (mensaje técnico saneado, sin datos personales), `plan_id` (null si no se guardó plan), `version_motor`, `usuario_id`. Solo inserción |
| `planes` | `id`, `fecha`, `estado` (`propuesto` \| `validado` \| `descartado`), `version`, `generado_en`, `generado_por`, `revision_iniciada_en`, `validado_en`, `validado_por`, `descartado_en`, `semilla`, `version_motor`, `entrada` (jsonb: la `EntradaPlan` exacta), `versiones` (jsonb: §3.2), `resultado` (jsonb: el `Plan` vigente, con la traza original), `ajustes` (jsonb: lista de `AjusteManual` con autor y hora), `requisitos_confirmados_en`. Índice único parcial: un solo `validado` por fecha |
| `rutas` | `id`, `plan_id`, `jornada_id`, `numero_viaje`, `version`, `salida_estimada`, `regreso_estimado`, `fin_descarga_estimado`, `carga_kg`, `km_estimados`, `km_contrafactual`, `rendimiento_km_l_usado` (copiado de la unidad al validar), `disponible_para_salir_en`, `asignada_en`, y para el Plan 5 `salida_patio_en`, `regreso_patio_en`, `descarga_fin_en`, `odometro_inicio_km`, `odometro_fin_km`. Único por (`plan_id`, `jornada_id`, `numero_viaje`) |
| `paradas` | `id`, `ruta_id`, `solicitud_id`, `secuencia` (único por ruta), `ventana_inicio` y `ventana_fin` (`time`), `llegada_estimada`, `inicio_estimado` y `fin_estimado` (`timestamptz`), `espera_min`, `carga_kg`, `km_desde_anterior`, `km_contrafactual` (viaje redondo patio–cliente–patio de esa solicitud), `vigente`, y para el Plan 5 `llegada_en`, `inicio_servicio_en`, `fin_servicio_en` y `estado` (`pendiente` \| `en_sitio` \| `completada` \| `omitida` \| `no_atendida`, por omisión `pendiente`). Índice único parcial sobre `solicitud_id` donde `vigente` |

### Reglas de los campos

- **Horas.** Las horas del motor (minutos desde la medianoche de la fecha) se convierten a `timestamptz` con `instanteDeMinutos` (§3.2).
- **K1.** `disponible_para_salir_en`:
  - en el viaje 1, la hora `disponible_desde` de la jornada;
  - en los viajes siguientes, el `fin_descarga_estimado` del viaje anterior. El Plan 5 lo reemplaza por el `descarga_fin_en` real.

  `asignada_en` es la hora de validación.
- **K4.**
  - `rutas.km_contrafactual` es la suma de `paradas.km_contrafactual` del viaje al validar;
  - el Plan 6 suma solo las paradas `completada` para comparar contra las mismas solicitudes atendidas;
  - `rendimiento_km_l_usado` queda congelado en el valor que tenía la unidad al validar.
- **Jornadas.** `rutas.jornada_id` apunta a `jornadas` con `ON DELETE RESTRICT`. `quitarJornada` responde `conflicto` con el motivo "La jornada ya tiene rutas asignadas" en lugar de fallar con la llave foránea (P3).
- **Permisos de `rs_app`:**
  - `ejecuciones_motor`: solo `SELECT` e `INSERT`;
  - `planes`, `rutas` y `paradas`: sin `DELETE`.

## 3. Contratos

### 3.1 Motor (Codex): ajustes manuales

Se agregan a `src/motor/tipos.ts` y se exportan desde `src/motor/index.ts`:

```ts
/** "pospuesta_a_mano": la pone solo un ajuste del despachador (diagnostico null); el motor nunca la produce. */
export type MotivoPospuesta = "sin_unidades_disponibles" | "sin_unidad_compatible" | "sin_cupo" | "pospuesta_a_mano";

/** viaje y posicion se interpretan DESPUÉS de retirar la solicitud de donde estaba. viaje n+1 abre un viaje nuevo. */
export type AjusteManual =
  | { tipo: "mover"; solicitudId: string; unidadId: string; viaje: number; posicion: number }
  | { tipo: "posponer"; solicitudId: string }
  /** Recalcula todas las rutas con las mismas secuencias a partir de instanteMin (mayor que el actual de la entrada). */
  | { tipo: "actualizarHora"; instanteMin: number };

export type CausaNoFactible = "capacidad" | "ventana" | "finDeTurno" | "tipoNoAdmitido";

export type ResultadoRecalculo =
  | { ok: true; ruta: RutaPlan }
  | { ok: false; error: "entrada_invalida"; detalle: string }
  | { ok: false; error: "no_factible"; causa: CausaNoFactible; viaje: number; solicitudId: string | null };

/** entrada cambia solo con actualizarHora: instanteMin nuevo y libreDesdeMin = max(el anterior, instanteMin). */
export type ResultadoAjuste =
  | { ok: true; plan: Plan; entrada: EntradaPlan }
  | { ok: false; error: "entrada_invalida"; detalle: string }
  | { ok: false; error: "no_factible"; causa: CausaNoFactible; unidadId: string; viaje: number; solicitudId: string | null };

/**
 * Recalcula la ruta de una unidad con las solicitudes en el orden dado (un arreglo por viaje), con las mismas reglas
 * de horarios, ventanas, capacidad, turno, regreso y descarga que la admisión. No reordena.
 */
export function recalcularRuta(entrada: EntradaPlan, unidadId: string, viajes: string[][]): ResultadoRecalculo;

/** Aplica un ajuste: recalcula las rutas afectadas, actualiza pospuestas y el resumen completo. Conserva la traza original. */
export function ajustarPlan(entrada: EntradaPlan, plan: Plan, ajuste: AjusteManual): ResultadoAjuste;

export function validarPlan(entrada: EntradaPlan, plan: Plan, opciones?: { ajustadoAMano: boolean }): string[];
```

**`recalcularRuta`:**

- **Entrada inválida:**
  - unidad desconocida;
  - solicitud desconocida o repetida;
  - una entrada con `cargaActualKg > 0` o con `ubicacionInicial` distinta del patio. Por ahora solo admite el plan inicial; el re-ruteo del Plan 5 la extenderá.
- **Viajes vacíos:** acepta `[]` y viajes vacíos. Los elimina, renumera los viajes 1, 2, … y, si no queda ninguna visita, devuelve `{ unidadId, viajes: [] }`. Esa ruta vacía se conserva en el plan, como hace `generarPlan`.
- **Qué solicitud señala `solicitudId`:**

  | Causa | Solicitud señalada |
  |---|---|
  | `ventana` | La parada cuya ventana no se cumple |
  | `tipoNoAdmitido` | La que no admite el tipo de la unidad |
  | `capacidad` | La primera del viaje con la que la carga acumulada supera la capacidad |
  | `finDeTurno` | La parada que termina tarde, o `null` si lo que se pasa es el regreso o la descarga |

**`ajustarPlan`:**

- Mover una solicitud pospuesta la saca de `pospuestas`. Mover una bloqueada es `entrada_invalida`.
- Posponer la quita de su ruta y la agrega a `pospuestas` con `pospuesta_a_mano`.
- Actualizar la hora recalcula cada ruta con `recalcularRuta` sobre la entrada nueva. Si alguna deja de ser factible, responde `no_factible` con esa unidad, y el despachador ajusta o regenera.
- El resumen se recalcula completo, incluido el contrafactual de las solicitudes que quedan ruteadas.

**`validarPlan` con `ajustadoAMano: true`.** El servidor decide el valor según si `planes.ajustes` tiene elementos; nunca lo toma del navegador.

- **Se omiten:**
  - la longitud y el orden FIFO de la traza;
  - la igualdad de `rutasAntes`;
  - la reproducción de admisiones;
  - la búsqueda de inserciones que demuestra una posposición;
  - las comparaciones finales contra lo reconstruido desde la traza.
- **Se agrega:** la reconstrucción independiente de cada ruta final, con la lógica de `reconstruir` y no con `calcular`, comparada completa con la ruta recibida. El oráculo sigue siendo independiente de la admisión (Plan 3, §9).
- **Se conservan:**
  - versión del motor;
  - unicidad de la entrada;
  - fechas ISO;
  - unidades conocidas, sin repetir y una ruta, aunque esté vacía, por cada unidad de la entrada;
  - partición exacta: cada solicitud de la entrada está ruteada, pospuesta o bloqueada;
  - resumen;
  - capacidad, tipo admitido, ventanas, secuencias, tiempos, distancias y descarga obligatoria.
- **Motivos:**
  - `pospuesta_a_mano` exige `diagnostico: null`;
  - `sin_unidades_disponibles` y `sin_unidad_compatible` deben seguir siendo ciertos;
  - `sin_cupo` conserva la validación de la forma del diagnóstico, entendido como diagnóstico de la generación original.
- Con `false` o sin opciones, todo queda como en el Plan 3, y `pospuesta_a_mano` es un error.

**Excepción a FIFO (especificación §7.4 y §7.6).** FIFO obliga a la propuesta automática. Un ajuste manual puede posponer una solicitud antigua o adelantar una reciente: es una decisión del despachador, que queda identificada en `planes.ajustes` y en la bitácora, y la traza original se conserva como evidencia.

### 3.2 Dominio (Codex): conversión a la entrada del motor (`src/dominio/plan/`)

```ts
// src/dominio/plan/tipos.ts
/** Parámetros de configuración que usa el plan. ConfiguracionCompleta (src/datos) es compatible por estructura; el dominio no importa de datos. */
export interface ConfiguracionPlan {
  patioLat: number | null; patioLng: number | null;
  turnoInicio: string; turnoFin: string;        // "HH:MM"
  velocidadKmh: number; factorCircuidad: number; descargaMin: number;
  cargaPorOmisionKg: number; diasOperacion: number[]; diasParaAtrasada: number; versionAvisoPrivacidad: string;
}
export interface JornadaParaPlan { jornadaId: string; disponibleDesde: string /* "HH:MM" o "HH:MM:SS" */; unidad: UnidadGuardada }
/** Versiones de todo lo que sustentó la propuesta; validar compara contra lo actual. */
export interface VersionesPlan {
  solicitudes: Record<string, number>; clientes: Record<string, number>;
  jornadas: Record<string, number>; unidades: Record<string, number>; operadores: Record<string, number>;
  configuracion: number;
}

// src/dominio/plan/entrada.ts
export function minutosDeHora(hhmm: string): number;                        // acepta "HH:MM" y "HH:MM:SS"
export function semillaDeFecha(fecha: string): number;                       // AAAAMMDD como entero
/** Minuto actual en Ciudad de México, redondeado hacia arriba si hay segundos. Usa Intl con la zona explícita, no TZ. */
export function minutoEnMexico(instante: Date): number;
/** Instante de "fecha + minutos" en Ciudad de México. Sin desfases fijos; probado en medianoche, fin de mes y cambio de fecha UTC. */
export function instanteDeMinutos(fecha: string, minutos: number): Date;
/** Ventanas del cliente para el día de la semana de fecha (diaSemanaDeFecha), en minutos. */
export function ventanasDelDia(cliente: Cliente, fecha: string): VentanaMin[];
/**
 * Arma la entrada del motor. Lanza ErrorDeEntrada("sin_patio") si falta la ubicación del patio y ErrorDeEntrada("fecha_pasada") si fecha < hoy.
 * - instanteMin: max(turnoInicio, minutoEnMexico(ahora) + MARGEN_REVISION_MIN) si fecha es hoy; turnoInicio si es futura.
 * - SolicitudMotor: registradaEn.toISOString(), cargaKg = cargaEfectivaKg, ubicación y servicio del cliente, tiposUnidadAdmitidos del cliente.
 * - UnidadMotor: id = jornadaId, ubicacionInicial = patio, libreDesdeMin = max(minutosDeHora(disponibleDesde), instanteMin), cargaActualKg = 0.
 * - capacidadMaximaPorTipoKg: sobre TODAS las unidades activas del catálogo, aunque hoy no estén disponibles.
 */
export function construirEntrada(datos: {
  fecha: string; ahora: Date;
  solicitudes: { solicitud: SolicitudGuardada; cliente: ClienteGuardado }[];   // solo las 'lista' de colaDelDia(fecha)
  jornadas: JornadaParaPlan[];                                                 // solo las disponibles
  unidadesActivas: UnidadGuardada[];
  configuracion: ConfiguracionPlan;
}): EntradaPlan;
export class ErrorDeEntrada extends Error { constructor(readonly codigo: "sin_patio" | "fecha_pasada") }
/** Minutos que se dan al despachador para revisar antes de la primera salida (al generar y al actualizar la hora). */
export const MARGEN_REVISION_MIN = 10;
/** Mayor capacidad de las unidades activas por tipo; la usan construirEntrada y la validación. */
export function capacidadMaximaPorTipo(unidadesActivas: UnidadGuardada[]): Record<TipoUnidad, number>;

/** Clientes de la ruta de cada jornada que exigen un requisito de acceso que depende del operador. */
export const TIPOS_REQUISITO_OPERADOR = ["induccion_seguridad_cliente"] as const;
export function requisitosPorJornada(plan: Plan, clientesPorSolicitud: Map<string, ClienteGuardado>): Map<string, { clienteId: string; nombre: string; tipos: string[] }[]>;
```

Las versiones (`VersionesPlan`) las arma la acción con lo leído en la misma instantánea.

**Estados de solicitud (Codex):**

- `EstadoSolicitud` agrega `programada` y `en_ruta`, con sus etiquetas en `ETIQUETA_ESTADO_SOLICITUD`;
- `colaDelDia` clasifica `programada` y `en_ruta` como `programada`, un estado nuevo de `ElementoCola`, y no como `cerrada`;
- el mapa exhaustivo de etiquetas de `src/components/solicitudes/cola-solicitudes.tsx` se adapta en el mismo commit, para que compile.

### 3.3 Acciones y consultas (Claude)

| Permiso | Roles | Qué permite |
|---|---|---|
| `planes.ver` | despachador, gerencia (y admin, como siempre en `puede`) | Ver el plan |
| `planes.generar` | despachador | Generar, iniciar la revisión, ajustar y descartar |
| `planes.validar` | despachador | Validar |

```ts
// src/consultas/plan.nucleo.ts — planes.ver
export interface ParadaVista {
  solicitudId: string; folio: string; secuencia: number;
  cliente: { id: string; nombre: string; lat: number; lng: number; direccion: string | null };
  ventana: { inicio: string; fin: string }; llegada: string; inicio: string; fin: string; // "HH:MM"
  esperaMin: number; cargaKg: number; kmDesdeAnterior: number;
}
export interface ViajeVista { numero: number; salida: string; regreso: string; finDescarga: string; cargaKg: number; capacidadKg: number; km: number; paradas: ParadaVista[] }
export interface UnidadEnPlan { jornadaId: string; unidad: UnidadResumen; operador: OperadorResumen; viajes: ViajeVista[] }
export interface VistaPlan {
  fecha: string; planId: string | null; estado: "sin_plan" | "propuesto" | "validado"; version: number | null;
  generadoEn: Date | null; revisionIniciada: boolean; ajustes: number;
  patio: { lat: number; lng: number } | null; unidades: UnidadEnPlan[];
  pospuestas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoPospuesta; diagnostico: Diagnostico | null }[];
  /** Solo bloqueos físicos del motor (carga mayor que cualquier unidad). Los clientes bloqueados no llegan al motor: están en la cola. */
  bloqueadas: { solicitudId: string; folio: string; cliente: string; motivo: MotivoBloqueoMotor }[];
  resumen: Plan["resumen"] | null;
  ultimaEjecucion: { duracionMs: number; resultado: "ok" | "error" | "tiempo_agotado"; en: Date } | null;
  /** Solicitudes listas para la fecha registradas o liberadas después de generar: invitan a regenerar. */
  nuevasDesdeGeneracion: number;
  requisitos: { jornadaId: string; operador: string; clientes: { nombre: string; tipos: string[] }[] }[];
  puedeGenerar: boolean; puedeValidar: boolean; estiloMapaUrl: string;
}
obtenerPlan(ctx, fecha: unknown): Promise<Resultado<VistaPlan>>   // el validado de la fecha o, si no hay, el propuesto vigente

// src/acciones/plan.nucleo.ts
generarPlanDelDia(ctx, fecha: unknown): Promise<Resultado<{ planId: string }>>
iniciarRevision(ctx, planId: unknown): Promise<Resultado<null>>
ajustarPlanDelDia(ctx, planId: unknown, versionEsperada: unknown, ajuste: unknown /* AjusteManual */): Promise<Resultado<{ version: number }>>
validarPlanDelDia(ctx, planId: unknown, versionEsperada: unknown, entrada: unknown /* { requisitosConfirmados: true } */):
  Promise<Resultado<{ programadas: number; pospuestas: number }>>
descartarPlan(ctx, planId: unknown, versionEsperada: unknown): Promise<Resultado<null>>
```

**Cambio del contrato compartido `Resultado` (P0b, acordado con Codex).** El conflicto puede llevar un motivo tipado, compatible con los conflictos actuales:

```ts
// src/acciones/tipos.ts
export type CodigoConflicto =
  | "plan_validado_existente" | "generacion_adelantada" | "datos_cambiaron" | "cliente_no_habilitado"
  | "capacidades_cambiaron" | "solicitud_asignada" | "hora_vencida" | "jornada_con_rutas";
export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; error: "no_autenticado" | "no_autorizado" | "no_encontrado" }
  | { ok: false; error: "conflicto"; motivo?: { codigo: CodigoConflicto; texto: string } }
  | { ok: false; error: "invalido"; campos: Record<string, string[]> };
```

Las pantallas existentes no cambian. La del plan muestra `motivo.texto` y, con `hora_vencida`, ofrece **Actualizar horarios**; con `generacion_adelantada` o `datos_cambiaron`, **Regenerar**. Donde este plan dice "conflicto con el motivo", se refiere a este campo.

En la cola (`src/consultas/solicitudes.nucleo.ts`), la consulta de la fecha agrega las solicitudes con parada vigente en un plan validado de esa fecha, aunque su fecha solicitada sea otra.

## 4. Reglas

### Candados y orden

- **Candado de la fecha:** `pg_advisory_xact_lock(727005, AAAAMMDD)`. Lo toman, antes que cualquier otro bloqueo, el guardado de generar, ajustar, descartar y validar, y también asignar y quitar jornada. Así, dos operaciones sobre la misma fecha se ordenan aunque todavía no haya jornadas ni plan.
- **Candado del catálogo de flota:** `727006`. Lo toman validar, en modo compartido (`pg_advisory_xact_lock_shared`), y el alta o edición de una unidad, en modo exclusivo, antes de tocar su renglón. Protege las capacidades máximas por tipo hasta que la validación termina.

Orden estable de bloqueos al validar:

1. candado de la fecha;
2. candado del catálogo de flota (compartido);
3. plan (`FOR UPDATE`);
4. jornadas de la fecha (`FOR UPDATE`, por id);
5. unidades y operadores de esas jornadas (`FOR SHARE`, por id);
6. clientes (`FOR SHARE`, por id);
7. solicitudes que se van a escribir, ruteadas y pospuestas (`FOR UPDATE`, por id);
8. configuración (`FOR SHARE`).

Asignar jornada sigue el mismo orden: fecha, jornadas por id, y unidad y operador. Editar una unidad toma el candado del catálogo y luego su renglón. Ninguna operación toma estos candados en otro orden.

### Generar

1. Validar la fecha: hoy o un día de operación futuro. Si no, `invalido`.
2. Leer en una instantánea (`leerInstantanea`, REPEATABLE READ) la configuración, las solicitudes con sus clientes completos, `colaDelDia(fecha)`, las jornadas de la fecha, las unidades activas, los operadores, los catálogos y la **generación esperada**: el id y la versión del `propuesto` vigente de la fecha, o ninguno. Elegir las solicitudes `lista` y las jornadas cuya unidad y operador están disponibles. Armar `entrada` con `construirEntrada` y `versiones`.
3. Ejecutar el motor fuera de toda transacción, midiendo con `performance.now()`. Si tarda más de `LIMITE_MOTOR_MS` (30 000), la corrida cuenta como `tiempo_agotado` y su plan no se guarda. El motor es síncrono y no se interrumpe; se descarta su resultado.
4. Guardar en una transacción:
   - el candado de la fecha;
   - si ya hay un `validado` para la fecha, `conflicto` (`plan_validado_existente`), porque los cambios del día se hacen con el re-ruteo del Plan 5;
   - si el `propuesto` vigente no es el de la generación esperada (otra generación terminó antes, o hubo un ajuste mientras el motor calculaba), `conflicto` (`generacion_adelantada`): se conserva el vigente y la ejecución se registra sin plan;
   - si no, se descarta el `propuesto` anterior y se inserta el nuevo;
   - la ejecución del motor con `plan_id` y la bitácora.
5. Si el motor falla, si se agota el tiempo o si falla el guardado, una transacción aparte inserta la ejecución con `plan_id = null` y su resultado (`error`, `tiempo_agotado`, o `ok` si lo que falló fue el guardado), más la bitácora. La acción responde `invalido` con un mensaje general.

Los mensajes técnicos se sanean: solo el nombre del error y un código, nunca la excepción completa. Los ajustes manuales no cuentan como ejecuciones del motor; quedan en `planes.ajustes` y en la bitácora.

### Iniciar revisión (K6)

- Requiere `planes.generar`, así que ni gerencia ni una precarga la activan.
- Fija `revision_iniciada_en` una sola vez y no cambia la versión del plan.
- La pantalla la llama al abrir un propuesto. Ajustar también la fija, si faltaba.
- Validar sin revisión iniciada responde `invalido`.

### Ajustar

1. Tomar el candado de la fecha, bloquear el plan y comprobar que está `propuesto` y en su versión.
2. Llamar a `ajustarPlan`. Si responde `no_factible`, `invalido` con el motivo legible en `campos._`. Si responde `entrada_invalida`, `invalido` general. Con `actualizarHora`, el servidor calcula `instanteMin` (el navegador no lo manda) y guarda también la `entrada` nueva.
3. Comprobar que `validarPlan(entrada, nuevo, { ajustadoAMano: true })` devuelve vacío. Si no, es un error del servidor: se registra y se responde `invalido` general.
4. Guardar `resultado`, agregar el ajuste a `ajustes`, subir la versión y escribir la bitácora con los campos `resultado` y `ajustes`.

### Validar

Todo ocurre en una transacción, y las comprobaciones van antes de cualquier escritura. Un conflicto que aparezca después, como el índice único de paradas, lanza un error que revierte todo y que se traduce fuera de la transacción.

1. Bloquear en el orden de arriba. Tomar la hora (`ahora`) **después** de los bloqueos. Comprobar:
   - plan `propuesto`, en su versión y con revisión iniciada;
   - `requisitosConfirmados === true`;
   - fecha no pasada.
2. Comparar `versiones` contra lo actual. Es conflicto si:
   - cambió la versión de alguna solicitud, cliente, jornada, unidad, operador o de la configuración;
   - hay jornadas nuevas o quitadas para la fecha.

   Las solicitudes nuevas no invalidan la propuesta: esperan al siguiente plan o al re-ruteo, y la vista invita a regenerar.
3. Volver a comprobar la disponibilidad de unidades y operadores con las funciones existentes y la fecha del plan.
4. **Habilitación de clientes:** releer la privacidad de los clientes bloqueados y aplicar `motivosDeBloqueoCliente` con la fecha del plan y la configuración actual. Si alguno ya no está habilitado, por ejemplo porque retiró su consentimiento, `conflicto` (`cliente_no_habilitado`). Retirar la privacidad bloquea el renglón del cliente (`FOR UPDATE`), así que espera a la validación o la validación lo espera a él.
5. **Capacidades:** `capacidadMaximaPorTipo` de las unidades activas actuales debe ser igual a `entrada.parametros.capacidadMaximaPorTipoKg`. Si no, `conflicto` (`capacidades_cambiaron`).
6. Comprobar cada solicitud que se va a escribir: `pendiente`, `proxima_fecha_elegible ≤ fecha` y sin parada vigente.
7. **Hora:** si la fecha es hoy, ninguna salida puede ser anterior a `minutoEnMexico(ahora)`. Si alguna lo es, `conflicto` (`hora_vencida`). La pantalla ofrece **Actualizar horarios**: el ajuste `actualizarHora` con `minutoEnMexico(ahora) + MARGEN_REVISION_MIN`, que recalcula las mismas secuencias, o informa qué ya no cabe. No hay tolerancia: una salida que ya pasó puede haber dejado fuera una ventana.
8. Como última comprobación, `validarPlan(entrada, resultado, { ajustadoAMano })` debe devolver vacío.
9. Escribir:
   - rutas y paradas con `vigente = true`, `asignada_en = ahora`, `disponible_para_salir_en`, contrafactuales y rendimiento;
   - ruteadas a `programada`, con `version + 1`;
   - pospuestas: `proxima_fecha_elegible = siguienteDiaOperacion(fecha, diasOperacion)`, `veces_pospuesta + 1` y `version + 1`, conservando `registrada_en` y `fecha_solicitada`;
   - el plan como `validado`, con `requisitos_confirmados_en`, y la bitácora.
10. Las bloqueadas por el motor no cambian. Siguen pendientes y en la cola.

Cualquier conflicto responde `conflicto` con su `motivo` (§3.3).

### Descartar

Candado de la fecha, plan `propuesto` en su versión, estado `descartado` y bitácora. Las solicitudes no se tocan.

## 5. Pantalla (Codex)

`/despacho/plan?fecha=`, con el enlace "Plan del día" en la navegación del despacho.

1. **Encabezado:**
   - fecha y estado;
   - **Generar plan**, o **Regenerar** si hay un propuesto;
   - duración y resultado de la última ejecución del motor;
   - aviso de solicitudes nuevas desde que se generó.
2. **Resumen:**
   - ruteadas, pospuestas y bloqueadas;
   - km y minutos de traslado;
   - comparativo simulado contra el método actual, rotulado como **simulado**.
3. **Por unidad** (operador y placa), cada viaje con sus paradas:
   - folio, cliente y ventana;
   - llegada, espera, inicio y fin;
   - carga y km.
4. **Mapa:** patio y rutas, con un color por unidad y líneas entre paradas (GeoJSON en MapLibre).
5. **Ajustes**, solo en planes propuestos:
   - **Mover:** con selectores de unidad, viaje y posición, sin arrastrar, para una parada o una pospuesta;
   - **Posponer:** para una parada;
   - **Actualizar horarios:** cuando la validación responde `hora_vencida`;
   - si se rechaza, se muestra el motivo.
6. **Pospuestas y bloqueadas**, con motivo y diagnóstico legibles.
7. **Requisitos de acceso:** por operador, con la casilla de confirmación que habilita **Validar**.
8. **Acciones finales:** **Validar** y **Descartar**.
9. **Solo lectura** en planes validados y siempre para gerencia.
10. **Inicio de la revisión:** al abrir un propuesto con permiso de generar, la pantalla llama a `iniciarRevision`.
11. **Cola:** muestra el estado "Programada".

## 6. Tareas

| # | Responsable | Tarea |
|---|---|---|
| P0a | Codex | Contratos compilables en motor y dominio: tipos de §3.1 y §3.2. Solo las funciones **nuevas** llevan cuerpo `throw new Error("pendiente")`; `validarPlan` conserva su comportamiento y solo amplía su firma. Estados `programada`/`en_ruta`, etiquetas, estado `programada` de la cola y el mapa de etiquetas de `cola-solicitudes.tsx`, para que el commit compile solo |
| P0b | Claude | Migración `0005` con permisos, permisos de la aplicación, conflicto con motivo en `Resultado`, tipos de `VistaPlan` y firmas de acciones y consultas con cuerpo pendiente. Prueba de integración de los índices únicos por separado (paradas vigentes, un validado y un propuesto por fecha). Se verifica sobre P0a, porque el esquema amplía los estados de solicitud |
| — | Ambos | Revisión cruzada de P0 antes de seguir |
| P1 | Codex | `recalcularRuta`, `ajustarPlan` y `validarPlan` con `ajustadoAMano`. Pruebas de propiedades: todo ajuste aceptado pasa `validarPlan`, todo rechazo tiene causa cierta, y las rutas vacías y la renumeración funcionan |
| P2 | Codex | Conversión de `src/dominio/plan`. Pruebas de ventanas por día, minutos, redondeo, `instanteDeMinutos` (medianoche, fin de mes, cambio de fecha UTC), semilla, sin patio, fecha pasada, capacidad máxima con unidades no disponibles y requisitos por jornada |
| P3 | Claude | Repositorios, acciones y consultas, y la adaptación de asignar y quitar jornada (candado de la fecha, bloqueo por id, conflicto con rutas) y de editar unidad (candado del catálogo). Pruebas: generar (incluidos el error del motor, el tiempo agotado y el fallo del guardado registrados), dos generaciones con finalización invertida, ajuste durante una generación, ajustar, validar con las cuatro combinaciones concurrentes (ruteada/ruteada, ruteada/pospuesta, pospuesta/pospuesta y cancelar o reprogramar contra validar), retiro de privacidad antes de validar y simultáneo, alta, activación y cambio de capacidad de una unidad simultáneos, jornada asignada o quitada durante la validación, versiones cambiadas, hora vencida y actualizar horarios, reversión completa, permisos, `quitarJornada` con rutas, y cola con una solicitud de ayer programada hoy |
| P4 | Codex | Pantalla de §5 |
| P5 | Codex escribe, Claude ejecuta | e2e con datos sintéticos: patio, clientes con ubicación y ventana hoy, unidad y operador disponibles, jornada y solicitudes. Generar, mover, posponer, confirmar requisitos y validar; la solicitud aparece "Programada" en la cola; gerencia en solo lectura |
| P6 | Ambos | Revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

## 7. Qué revisar con más cuidado

- **Validación simultánea.** Nunca dos paradas vigentes de la misma solicitud. Una pospuesta tampoco se puede escribir dos veces en paralelo.
- **Ajustes manuales.** Un ajuste no rompe capacidad, ventanas ni turno: lo garantiza `ajustarPlan` y lo comprueba `validarPlan` con un oráculo independiente.
- **Horas.** La conversión a `timestamptz` en Ciudad de México no depende de `TZ` del contenedor.
- **K7.** El registro de la ejecución sobrevive a cualquier fallo, y su mensaje no lleva datos personales.
- **Pospuestas.** Al validar, no pierden `registrada_en`.
- **Orden de bloqueos.** Es el mismo en validar, asignar jornada y editar flota. Una prueba con las dos operaciones a la vez no termina en `40P01`.
- **Hora actual.** Al validar, la hora se toma después de los bloqueos. Ninguna salida validada para hoy queda en el pasado.

## 8. Respuesta a la revisión de Codex (2026-10-15)

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | `recalcularRuta` promete más de lo que da `calcular` | Errores de entrada separados, viaje y `solicitudId` opcional, convención de capacidad (§3.1) |
| 2 | Viajes vacíos y unidades sin visitas | Se aceptan y se renumeran. Ruta vacía conservada. Solo plan inicial. Posición interpretada después de retirar (§3.1) |
| 3 | Omitir la traza exige otra comprobación | Se adopta tal cual la propuesta de Codex (§3.1, `validarPlan`) |
| 4 | Contrato de configuración en dominio y versiones | `ConfiguracionPlan` en dominio, `VersionesPlan` y conversiones explícitas (§3.2) |
| 5 | Validar no detecta cambios operativos ni envejecimiento | Comparación de versiones y relectura de disponibilidad. La regla de 15 minutos se sustituyó en la revisión 3 por la de hora vencida (§9.5) |
| 6 | El índice no protege a las pospuestas | Bloqueo `FOR UPDATE` de todas las solicitudes que se escriben, comprobaciones antes de escribir y reversión completa (§4) |
| 7 | Sincronizar JSON, rutas y paradas | Rutas y paradas se escriben solo al validar. El JSON es la verdad mientras el plan está propuesto (§2) |
| 8 | Carreras de generación y borrado de jornadas | Candado por fecha, `RESTRICT` y `quitarJornada` con conflicto claro (§2 y §4) |
| 9 | La cola no muestra programadas | Consulta por fecha operativa (Claude) y estado y etiquetas (Codex) (§3.2 y §3.3) |
| 10 | Conversión de horas, K1 y K4 | `instanteDeMinutos` y `minutoEnMexico` con Intl. Reglas de K1 y K4 en §2. Los turnos que cruzan la medianoche no se admiten, como hoy |
| 11 | K6 y K7 incompletos | `iniciarRevision` con permiso de generar. `tiempo_agotado` por límite medido. Ejecución en transacción aparte si falla. Los ajustes no cuentan como ejecución (§4) |
| 12 | Excepción a FIFO, requisitos por operador y P0 | Excepción documentada (§3.1). `TIPOS_REQUISITO_OPERADOR` explícito. P0 dividido en contratos compilables de cada responsable (§6) |

## 9. Respuesta a la revisión de Codex de la revisión 2 (2026-10-15)

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | Retirar la privacidad no cambia ninguna versión | Validar relee la privacidad y aplica `motivosDeBloqueoCliente` con los clientes bloqueados (§4, Validar 4). Pruebas antes y simultáneo (P3) |
| 2 | Las jornadas no toman el candado de la fecha | Asignar y quitar jornada toman el candado de la fecha y bloquean por id (§4, Candados; P3) |
| 3 | Una generación antigua puede sustituir a una reciente | Generación esperada leída en la instantánea y comprobada al guardar: `generacion_adelantada` (§4, Generar) |
| 4 | Catálogo de unidades sin protección | Candado del catálogo de flota (compartido al validar, exclusivo al editar unidades) y comparación de `capacidadMaximaPorTipo` (§4) |
| 5 | La tolerancia de 15 minutos no garantiza factibilidad | Sin tolerancia: hora tomada después de los bloqueos, `hora_vencida` y ajuste `actualizarHora`, que recalcula las mismas secuencias. `MARGEN_REVISION_MIN` de 10 minutos al generar y al actualizar (§3.1, §3.2 y §4) |
| 6 | `conflicto` no lleva motivo en el contrato | Variante `conflicto` con `motivo` tipado en `Resultado`, compatible con lo existente (§3.3; P0b) |
| 7 | Alcance de P0a | Cuerpos pendientes solo en funciones nuevas. `validarPlan` conserva su comportamiento. El mapa de etiquetas de la cola se adapta en P0a. P0b se verifica sobre P0a (§6) |
