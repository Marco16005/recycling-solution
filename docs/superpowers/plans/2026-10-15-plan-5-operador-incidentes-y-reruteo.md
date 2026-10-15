# Plan 5 — Aplicación del operador, incidentes y re-ruteo

- **Fecha:** 2026-10-15. **Revisión:** 1 (borrador para revisión de Codex).
- **Especificación:** §5 (pasos 5 y 6 del flujo), §6 (`eventos_operador`, `incidentes`, campos reales de `rutas` y `paradas`), §7 reglas 5 a 7, §8 (re-ruteo), §9 (Mi ruta), §10 (privacidad), §11 (K1, K3, K4).
- **Base:** `claude/plan-4` (Plan 4 terminado).
- **Ejecutan:** Claude (datos, acciones, consultas) y Codex (dominio de eventos, motor, pantallas, e2e). Reparto en §6.

## 1. Objetivo y aceptación

1. **Mi ruta.** El operador entra desde su teléfono a `/operador` y ve su jornada del día: la unidad y, por viaje, sus paradas en orden, con:
   - cliente, dirección, notas de acceso y ventana;
   - horas estimadas y carga estimada;
   - un enlace `geo:` para abrir la ubicación en el mapa del teléfono, sin que la aplicación consulte servicios externos.
2. **Eventos.** El operador registra los eventos de su jornada. Cada evento lleva un `evento_id` generado en el teléfono, la hora en que ocurrió y la versión de la ruta que vio.

   | Evento | Cuándo | Captura |
   |---|---|---|
   | Llegada al patio | `check_in` | — |
   | Salida del patio | `salida_patio`, por viaje | Odómetro |
   | Llegada a la parada | `llegada` | — |
   | Inicio del servicio | `inicio_servicio` | — |
   | Fin del servicio | `fin_servicio` | — |
   | No atendida | `no_atendida` | Motivo |
   | Regreso al patio | `regreso_patio`, por viaje | Odómetro |
   | Fin de la descarga | `fin_descarga`, por viaje | — |
   | Salida de la jornada | `check_out` | — |
3. **Idempotencia.** Un evento repetido (mismo `evento_id` y mismo contenido) no se duplica y responde lo mismo que la primera vez. El mismo `evento_id` con otro contenido responde `conflicto`.
4. **Transiciones.** Las transiciones inválidas se rechazan con el motivo; por ejemplo, terminar una parada sin haber llegado, salir del patio sin `check_in` o un odómetro menor que el anterior.
5. **Alcance del operador.** Un operador solo ve y modifica las rutas de **su** jornada (`jornadas.operador_id = usuarios.operador_id`). Un evento sobre una ruta ajena responde `no_encontrado`.
6. **Mala señal.** La ruta del día queda guardada en el teléfono y se muestra sin conexión. Los eventos se encolan en el teléfono y se reintentan en orden. La cola sobrevive a recargar la página, y la pantalla muestra cuántos eventos faltan por enviar. Al primer rechazo, la cola se detiene y muestra el motivo.
7. **Incidentes.** El operador reporta un incidente (`averia` \| `retraso` \| `cierre_vial` \| `cliente_no_disponible` \| `otro`), con descripción breve y, si quiere, la parada. El despachador ve los incidentes abiertos en el plan del día y los resuelve con una acción: `continuar`, `cancelar` (la solicitud de esa parada) o `re_ruteo`.
8. **Re-ruteo.** Sobre el plan validado de hoy, el despachador elige las jornadas que dejan de estar disponibles desde ahora, por ejemplo por avería, y pide una propuesta de re-ruteo. La propuesta:
   - **no toca** paradas completadas, no atendidas, en sitio ni el tramo comprometido;
   - **conserva**, en su unidad y en su orden, las paradas pendientes de las unidades disponibles, que solo pueden recibir inserciones;
   - **reubica en FIFO** las pendientes de las jornadas no disponibles y las solicitudes listas nuevas del día.

   Se revisa, se ajusta y se valida como el plan del día. Al validarla, el plan anterior queda `reemplazado` y el nuevo, `validado`.
9. **Captura para indicadores (K1, K3, K4).** Se llenan:
   - en rutas: `salida_patio_en`, `regreso_patio_en`, `descarga_fin_en` y los odómetros;
   - en paradas: `llegada_en`, `inicio_servicio_en`, `fin_servicio_en` y `estado`.

   Las solicitudes pasan a `en_ruta` al salir su viaje y a `atendida` al terminar su servicio.
10. **Verificación.** `scripts/verificar-todo.sh` en verde, con:
   - pruebas de propiedades de la máquina de eventos;
   - pruebas de integración de idempotencia y concurrencia (el mismo evento enviado dos veces a la vez, un evento mientras se valida un re-ruteo);
   - e2e en tamaño de teléfono: jornada completa, un evento repetido, un evento inválido y la cola sin conexión que se envía al volver la señal, más un incidente con re-ruteo.

## 2. Modelo de datos (Claude, migración `0006`)

| Tabla | Cambio |
|---|---|
| `eventos_operador` (nueva) | `id`, `evento_id` uuid **único**, `jornada_id`, `ruta_id` (null en `check_in`/`check_out`), `parada_id` (null salvo eventos de parada), `tipo`, `ocurrido_en` (reloj del teléfono), `recibido_en` (servidor), `version_ruta` (null si no hay ruta), `odometro_km` (salida y regreso), `motivo` (≤ 200, solo `no_atendida`), `huella` (SHA-256 del contenido canónico, para detectar el mismo `evento_id` con otro contenido), `usuario_id`. Solo inserción |
| `incidentes` (nueva) | `id`, `evento_id` uuid único (idempotencia desde el teléfono), `jornada_id`, `ruta_id` y `parada_id` (opcionales), `tipo`, `descripcion` (≤ 300; la pantalla pide no escribir datos personales), `reportado_en`, `reportado_por`, `resuelto_en`, `resuelto_por`, `accion` (`continuar` \| `cancelar` \| `re_ruteo`), `version`. Sin DELETE |
| `planes` | `tipo` (`inicial` \| `re_ruteo`, por omisión `inicial`), `plan_base_id` (el validado que reemplaza; obligatorio si `re_ruteo`), `estado` agrega `reemplazado`. Siguen los índices: un `validado` y un `propuesto` por fecha |
| `rutas` | `continua_ruta_id` (null, o la ruta del plan anterior cuyo viaje físico continúa: el viaje en curso de una unidad que se re-rutea) |
| `paradas` | `estado` agrega `reasignada` (la parada pasó a otra ruta en un re-ruteo; `vigente = false`). `motivo_no_atendida` (≤ 200) |
| `jornadas` | Ya tiene `check_in_en` y `check_out_en` (Plan 2) |

**Versiones y frescura.**

- `rutas.version` cambia solo por un re-ruteo: es la versión **estructural** que manda el teléfono, para que uno desactualizado reciba `conflicto` y recargue.
- Los eventos no cambian `rutas.version`. Si la cambiaran, los eventos encolados sin señal fallarían todos.
- Para detectar que la operación avanzó mientras se revisaba un re-ruteo, `versiones` del plan de re-ruteo guarda el **número de eventos por jornada** al generar.

## 3. Contratos

### 3.1 Dominio de la operación (Codex, `src/dominio/operacion/`)

```ts
export type TipoEvento =
  | "check_in" | "salida_patio" | "llegada" | "inicio_servicio" | "fin_servicio" | "no_atendida"
  | "regreso_patio" | "fin_descarga" | "check_out";
export type EstadoParadaOperacion = "pendiente" | "en_sitio" | "en_servicio" | "completada" | "no_atendida" | "reasignada";

/** Estado actual de una jornada, armado por la acción desde la base (con todo bloqueado). */
export interface EstadoJornada {
  fecha: string; checkIn: boolean; checkOut: boolean; ultimoOcurridoEn: string | null; ultimoOdometroKm: number | null;
  viajes: {
    rutaId: string; version: number; numero: number; continua: boolean;  // continua: el viaje físico ya salió en otra ruta
    salida: boolean; regreso: boolean; descarga: boolean;
    paradas: { paradaId: string; secuencia: number; estado: EstadoParadaOperacion }[];
  }[];
}
export interface EventoEntrada {
  eventoId: string; tipo: TipoEvento; ocurridoEn: string; rutaId: string | null; paradaId: string | null;
  versionRuta: number | null; odometroKm: number | null; motivo: string | null;
}
export type Efecto =
  | { tipo: "jornada"; campo: "check_in_en" | "check_out_en" }
  | { tipo: "ruta"; rutaId: string; campo: "salida_patio_en" | "regreso_patio_en" | "descarga_fin_en"; odometroKm?: number }
  | { tipo: "parada"; paradaId: string; estado: EstadoParadaOperacion; campo: "llegada_en" | "inicio_servicio_en" | "fin_servicio_en" | null; motivo?: string }
  | { tipo: "solicitudes_en_ruta"; rutaId: string }
  | { tipo: "solicitud_atendida"; paradaId: string }
  | { tipo: "solicitud_no_atendida"; paradaId: string };

/** Pura. recibidoEn: hora del servidor. Las reglas están en §4. */
export function aplicarEvento(estado: EstadoJornada, evento: EventoEntrada, recibidoEn: string):
  | { ok: true; efectos: Efecto[] }
  | { ok: false; motivo: string };

/** Huella canónica del contenido del evento (sin recibidoEn), para la idempotencia. */
export function huellaEvento(evento: EventoEntrada): string;

/** Frontera de lo congelado para el re-ruteo (§4, Re-ruteo). */
export function congeladoDeJornada(estado: EstadoJornada, plan: /* rutas del plan vigente con paradas */ unknown): {
  congeladas: string[];        // paradaIds que no se tocan
  comprometida: string | null; // la siguiente pendiente del viaje en curso, si el viaje salió y no hay parada en sitio
  pendientes: string[][];      // por viaje, en orden: lo que se conserva en la unidad (o se reubica si la jornada no está disponible)
};
```

### 3.2 Motor (Codex): admitidas previas

```ts
/**
 * admitidas: por unidad, viajes con solicitudes ya admitidas, en su orden. Se admiten antes de la cola FIFO,
 * no se quitan ni se reordenan entre sí y pueden recibir inserciones. Sus solicitudes vienen en entrada.solicitudes.
 * Si no son factibles tal cual, generarPlan lanza ErrorAdmitidas con la unidad y la causa.
 * El primer viaje de una unidad con cargaActualKg > 0 continúa el viaje en curso (Plan 3, UnidadMotor).
 */
export function generarPlan(entrada: EntradaPlan, opciones?: { admitidas?: Record<string, string[][]> }): Plan;
```

- La traza registra las admitidas previas como decisiones `admitida` con `previa: true`.
- `validarPlan` las excluye de la propiedad FIFO, pero comprueba que conservan su unidad y su orden relativo.

### 3.3 Acciones y consultas (Claude)

| Permiso | Roles |
|---|---|
| `ruta.operar` | operador (solo su jornada) |
| `operacion.ver` | despachador, gerencia |
| `incidentes.resolver` | despachador |
| re-ruteo | `planes.generar` y `planes.validar` |

```ts
// src/consultas/operador.nucleo.ts — ruta.operar
export interface VistaMiRuta {
  fecha: string; jornadaId: string | null; unidad: UnidadResumen | null; estado: EstadoJornada | null;
  viajes: { rutaId; version; numero; salidaEstimada; regresoEstimado; paradas: {
    paradaId; secuencia; folio; cliente: { nombre; direccion; notasAcceso; lat; lng }; ventana; llegadaEstimada; cargaKg; estado;
  }[] }[];
  incidentesAbiertos: { id; tipo; reportadoEn }[];
}
miRuta(ctx): Promise<Resultado<VistaMiRuta>>       // hoy en Ciudad de México

// src/acciones/operador.nucleo.ts — ruta.operar
registrarEventoOperador(ctx, evento: unknown /* EventoEntrada */): Promise<Resultado<{ estado: EstadoJornada; repetido: boolean }>>
reportarIncidente(ctx, entrada: unknown /* { eventoId, tipo, descripcion, paradaId? } */): Promise<Resultado<{ id: string; repetido: boolean }>>

// src/acciones/operacion.nucleo.ts
resolverIncidente(ctx, id, versionEsperada, entrada: unknown /* { accion } */): Promise<Resultado<{ version: number }>>   // incidentes.resolver
generarReruteo(ctx, fecha, entrada: unknown /* { jornadasNoDisponibles: string[] } */): Promise<Resultado<{ planId: string }>> // planes.generar
// validar un re-ruteo: validarPlanDelDia (Plan 4), que reconoce plan.tipo = "re_ruteo" (§4)

// src/consultas/operacion.nucleo.ts — operacion.ver
seguimiento(ctx, fecha): Promise<Resultado<{ porJornada: { jornadaId; operador; placa; avance: { completadas; pendientes; noAtendidas }; ultimoEvento: { tipo; en } | null }[]; incidentesAbiertos: {...}[] }>>
```

`CodigoConflicto` agrega `evento_distinto` (mismo `evento_id`, otro contenido), `ruta_cambiada` (versión de ruta vieja) y `operacion_avanzo` (cambiaron los eventos de una jornada mientras se revisaba el re-ruteo).

## 4. Reglas

### Eventos (`aplicarEvento`)

- **Orden y hora.**
  - `ocurrido_en` debe estar en la fecha de la jornada (Ciudad de México);
  - no puede ser anterior al último evento de la jornada ni más de 2 minutos posterior a `recibido_en`.
- **`check_in`:** una vez y antes de todo. **`check_out`:** cuando no queda ningún viaje con salida sin descarga y no hay paradas en sitio.
- **`salida_patio`:**
  - requiere `check_in`, que el viaje anterior esté descargado y que el viaje no sea una continuación;
  - el odómetro debe ser mayor o igual que el último de la unidad;
  - las solicitudes del viaje pasan a `en_ruta`.
- **`llegada`:**
  - a cualquier parada `pendiente` del viaje que ya salió (el operador puede cambiar el orden);
  - solo si no hay otra parada en sitio o en servicio.
- **Servicio:**
  - `inicio_servicio` requiere `en_sitio`;
  - `fin_servicio` requiere `en_servicio` y deja la parada `completada` y la solicitud `atendida`.
- **`no_atendida`:**
  - desde `pendiente` o `en_sitio`, con motivo;
  - la solicitud vuelve a `pendiente` para el siguiente día de operación, con una posposición más y su `registrada_en` original (decisión a confirmar con Codex: §8.1).
- **`regreso_patio`:** requiere todas las paradas del viaje cerradas (`completada`, `no_atendida` o `reasignada`) y un odómetro mayor o igual que el de salida. **`fin_descarga`:** requiere `regreso_patio`.
- **Paradas y rutas no vigentes:** un evento sobre una parada no vigente, o con `version_ruta` vieja, responde `conflicto` (`ruta_cambiada`).

### Registrar un evento (acción)

1. Validar la entrada con Zod.
2. Buscar el `evento_id`:
   - si ya existe con la misma huella, responder el estado actual con `repetido: true`;
   - si existe con otra huella, `conflicto` (`evento_distinto`).
3. Abrir la transacción:
   1. candado de la fecha;
   2. jornada `FOR UPDATE`, comprobando que es del operador;
   3. rutas y paradas vigentes;
   4. armar el `EstadoJornada` y llamar a `aplicarEvento`;
   5. aplicar los efectos e insertar el evento y la bitácora.
4. Si dos envíos simultáneos del mismo evento chocan en el índice único, el perdedor relee y responde `repetido` (o `evento_distinto`).

### Re-ruteo

**Qué se congela por jornada:**

- paradas `completada`, `no_atendida` y `reasignada`;
- la parada en sitio o en servicio;
- si el viaje en curso ya salió y no hay parada en sitio, la siguiente pendiente en secuencia (el **tramo comprometido**).

**Unidades disponibles.** Cada una entra al motor así:

- **ubicación inicial:** la última parada congelada del viaje en curso, o el patio si no hay viaje en curso;
- **libre desde:** el fin estimado de lo congelado, recalculado desde el último evento real y nunca antes de ahora;
- **carga:** la carga de las paradas congeladas del viaje en curso.

Sus pendientes no congeladas van como `admitidas`. El primer arreglo es la continuación del viaje en curso; si existe, la ruta nueva lleva `continua_ruta_id`.

**Jornadas no disponibles.**

- Sus pendientes no congeladas van como solicitudes a reubicar en FIFO.
- No se permite re-rutear una jornada no disponible con una parada en sitio: el despachador pide primero al operador cerrarla (`fin_servicio` o `no_atendida`).
- También entran las solicitudes `lista` del día que no están en ninguna parada vigente.

**Guardado.** Se guarda como plan `propuesto` de tipo `re_ruteo`, con `plan_base_id` y `versiones`, que incluyen los eventos por jornada. Se ajusta igual que en el Plan 4.

**Validación.** Es la del Plan 4, más:

- comprobar que el número de eventos por jornada no cambió (`operacion_avanzo`);
- marcar `reemplazado` el plan base;
- dejar `vigente = false` y estado `reasignada` en las paradas reubicadas del plan base;
- subir la `version` de las rutas base que pierden paradas;
- insertar las rutas nuevas (con `continua_ruta_id` donde aplica) y sus paradas vigentes;
- las paradas congeladas siguen vigentes en el plan base.

### Incidentes

- Reportar es idempotente por `evento_id`.
- Resolver exige la versión:
  - `cancelar` cancela la solicitud de la parada con el motivo "Cancelada por incidente" y deja la parada `reasignada`, sin vigencia;
  - `re_ruteo` solo marca la acción: el despachador genera el re-ruteo aparte.

### Privacidad

- No se captura la ubicación GPS del teléfono. El piloto no la necesita, porque K1, K3 y K4 salen de horas y odómetros (minimización, LFPDPPP art. 6 y 11).
- Si en el futuro se capturara, antes habría que actualizar el aviso del operador.
- Sigue vigente que un operador sin aviso entregado no está disponible (Plan 2).

## 5. Pantallas (Codex)

### `/operador` (teléfono)

- Encabezado con la fecha y la unidad. Indicador de conexión y de eventos pendientes de enviar.
- Botones grandes, de uno en uno, según el estado: "Llegué al patio", "Salgo del patio" (pide odómetro), "Llegué", "Empiezo", "Terminé", "No se pudo atender" (pide motivo), "Regresé al patio" (pide odómetro), "Terminé de descargar" y "Termino jornada".
- Lista de paradas del viaje con ventana, notas de acceso y enlace `geo:`.
- Reportar incidente.
- **Sin conexión:**
  - la última `VistaMiRuta` se guarda en `localStorage` y la cola de eventos también;
  - se reintenta al volver la señal (`online`) y cada 30 segundos, en orden;
  - un rechazo detiene la cola y muestra el motivo con la opción de descartar ese evento;
  - el `evento_id` se genera con `crypto.getRandomValues`, que funciona sin HTTPS en la red local (ya existe `generarOperacionId`).

### Plan del día (despacho)

En planes validados:

- **Seguimiento por unidad:** avance y último evento, con sondeo cada 30 segundos;
- **incidentes abiertos** con sus acciones;
- **Re-rutear:** elegir las jornadas no disponibles, generar, revisar las partes congeladas en solo lectura, ajustar y validar.

## 6. Tareas

| # | Responsable | Tarea |
|---|---|---|
| R0a | Codex | Contratos compilables de §3.1 y §3.2 (funciones nuevas pendientes; `generarPlan` amplía su firma sin cambiar su comportamiento) |
| R0b | Claude | Migración `0006`, permisos, códigos de conflicto, firmas de §3.3 pendientes y pruebas de integración de índices y permisos |
| R1 | Codex | Máquina de eventos y `congeladoDeJornada`, con pruebas de propiedades: ninguna secuencia aceptada deja dos paradas en sitio, una completada sin llegada o un odómetro decreciente |
| R2 | Codex | `admitidas` en el motor y en `validarPlan`, con pruebas de propiedades: las admitidas conservan unidad y orden, y FIFO se respeta entre las demás |
| R3 | Claude | Acciones y consultas de §3.3 y la validación de re-ruteo. Pruebas: idempotencia (secuencial y simultánea), huella distinta, operador ajeno, versión de ruta vieja, cada transición inválida, efectos en solicitudes, incidente y cancelar, re-ruteo con jornada averiada, operación que avanza durante la revisión, continuidad de viaje y K1/K3/K4 capturados |
| R4 | Codex | Pantallas de §5 |
| R5 | Codex escribe, Claude ejecuta | e2e en tamaño de teléfono de §1.10 (`context.setOffline` para la cola) |
| R6 | Ambos | Revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

## 7. Qué revisar con más cuidado

- Un reintento sin señal nunca duplica un evento ni lo aplica dos veces, incluso con dos envíos simultáneos.
- El re-ruteo no mueve nada congelado ni reordena las admitidas.
- Un viaje físico partido en dos rutas (`continua_ruta_id`) conserva sus odómetros para K4.
- Las horas del teléfono pueden estar mal: la regla de `ocurrido_en` (§4) y su prueba.
- La cola del teléfono no pierde eventos al recargar ni al cerrar la pestaña.

## 8. Decisiones para revisar con Codex

1. **Parada no atendida.** La solicitud vuelve a `pendiente` para el siguiente día de operación, conservando su lugar FIFO, y el despachador puede cancelarla. La alternativa es cerrarla como `no_atendida` y que el despachador la vuelva a registrar.
2. **Orden de las paradas.** El operador puede llegar a cualquier pendiente del viaje en curso. K1 usa la parada anterior **en el tiempo**, no en la secuencia planeada.
3. **Congelar el viaje en curso.** Se conserva en su unidad todo lo pendiente de las unidades disponibles (como `admitidas`); solo se reubica lo de las jornadas no disponibles y lo nuevo. Esto cumple "sin mover a las ya admitidas" (§7.4) con el contrato de `UnidadMotor` del Plan 3.
