# Plan 5 — Aplicación del operador, incidentes y re-ruteo

- **Fecha:** 2026-10-15.
- **Revisión:** 2. Incorpora los 10 hallazgos de Codex sobre el borrador; las respuestas están en §9.
- **Especificación:**
  - §5, pasos 5 y 6;
  - §6: `eventos_operador`, `incidentes` y los campos reales de rutas y paradas;
  - §7, reglas 4 a 7;
  - §8: re-ruteo;
  - §10;
  - §11: K1, K3 y K4;
  - §14: decisión 9 (operación sin señal).
- **Base:** `main` con el Plan 4.
- **Ejecutan:** Claude (datos, acciones, consultas, service worker) y Codex (máquina de eventos, motor, pantallas y e2e). Reparto en §7.

## 1. Objetivo y aceptación

1. **Mi ruta.** `/operador` muestra en el teléfono del operador su jornada: unidad, viajes y paradas en orden. De cada parada da:
   - cliente, dirección y notas de acceso;
   - ventana, hora estimada y carga estimada;
   - un enlace `geo:` que abre el mapa del teléfono, sin que la aplicación consulte servicios externos.
2. **Eventos.** Cada evento lleva un `evento_id` generado en el teléfono, la jornada, la hora en que ocurrió y la versión de ruta que vio el operador. La tabla de transiciones está en §4.

   | Botón | Evento | Captura |
   |---|---|---|
   | "Llegué al patio" | `check_in` | — |
   | "Salgo del patio" | `salida_patio` (por viaje) | odómetro |
   | "Llegué" | `llegada` | — |
   | "Empiezo" | `inicio_servicio` | — |
   | "Terminé" | `fin_servicio` | — |
   | "No se pudo atender" | `no_atendida` | motivo |
   | "Regresé al patio" | `regreso_patio` (por viaje) | odómetro |
   | "Terminé de descargar" | `fin_descarga` (por viaje) | — |
   | "Termino jornada" | `check_out` | — |

3. **Idempotencia.** Un evento repetido (mismo `evento_id` y misma huella) no se aplica dos veces. Responde el **resultado original** (aplicado, o rechazado con su motivo) con el estado actual de la jornada. El mismo `evento_id` con otra huella responde `conflicto` (`evento_distinto`). Dos envíos simultáneos del mismo evento producen una sola aplicación.
4. **Transiciones.** Las transiciones inválidas se rechazan con el motivo. Por ejemplo:
   - terminar sin haber llegado;
   - llegar a una parada que no es la siguiente;
   - repetir la salida del mismo viaje;
   - cualquier evento después de `check_out`;
   - un odómetro menor que el anterior.
5. **Alcance.** Un operador solo ve y opera su jornada (`jornadas.operador_id = usuarios.operador_id`). La autorización va antes de cualquier búsqueda, también la de un evento repetido.
6. **Sin señal** (decisión 9).
   - La pantalla `/operador` y la última ruta cargada se abren sin conexión, también al recargar o reabrir el navegador: un service worker guarda la pantalla y `localStorage` guarda la ruta, por usuario y jornada.
   - Los eventos se encolan y se envían en orden al volver la señal, hasta 24 horas después.
   - Un evento que el servidor no puede aplicar se **guarda como rechazado**, con su motivo, para que el despachador lo concilie. El teléfono lo saca de la cola, muestra "Llama al despachador" y sigue con los demás.
   - Al cerrar sesión se borra lo guardado en el teléfono.
7. **Incidentes.** El operador reporta `averia`, `retraso`, `cierre_vial`, `cliente_no_disponible` u `otro`, con una descripción breve y, si quiere, la parada; es idempotente. El despachador los ve en el plan validado y los resuelve:
   - `continuar`;
   - `cancelar`: la solicitud de una parada **pendiente**;
   - `re_ruteo`.
8. **Re-ruteo** (§4). Sobre el plan validado de hoy, el despachador elige las jornadas que dejan de estar disponibles y genera una propuesta, que **no toca**:
   - lo completado y lo no atendido;
   - la parada en sitio o en servicio;
   - el **viaje en curso completo** de cada unidad disponible.

   Conserva en su unidad, como restricción, los viajes futuros de las unidades disponibles. Reubica en orden FIFO lo pendiente de las jornadas no disponibles y las solicitudes listas nuevas. Se revisa, se ajusta y se valida. Al validarla, el plan base queda `reemplazado`.
9. **Captura (K1, K3 y K4).**
   - Rutas: `salida_patio_en`, `regreso_patio_en`, `descarga_fin_en` y odómetros. `disponible_para_salir_en` del viaje siguiente pasa a ser la descarga real.
   - Paradas: `llegada_en`, `inicio_servicio_en`, `fin_servicio_en`, `estado` y `motivo_no_atendida`.
   - Solicitudes:
     - pasan a `en_ruta` al salir su viaje y a `atendida` al terminar el servicio;
     - al quedar no atendidas, vuelven a `pendiente` para el siguiente día de operación y se libera su parada.
10. **Verificación.** `scripts/verificar-todo.sh` en verde, con:
   - propiedades de la máquina de eventos;
   - integración de idempotencia simultánea, evento contra re-ruteo y cancelación por incidente contra evento;
   - e2e en tamaño de teléfono: jornada completa, evento repetido, evento inválido, sin conexión con recarga y envío posterior, e incidente con re-ruteo.

## 2. Modelo de datos (Claude, migración `0006`)

| Tabla | Cambio |
|---|---|
| `eventos_operador` (nueva) | `id`, `evento_id` uuid único, `jornada_id`, `ruta_id` y `parada_id` (según el tipo), `tipo`, `ocurrido_en`, `recibido_en`, `version_ruta`, `odometro_km`, `motivo` (≤ 200), `huella` (SHA-256 del contenido canónico, jornada incluida), `usuario_id`, `resultado` (`aplicado` \| `rechazado`), `motivo_rechazo`, `conciliado_en`, `conciliado_por`, `nota_conciliacion` (≤ 300). `rs_app`: INSERT, y UPDATE solo de las columnas de conciliación (con `GRANT UPDATE (…)`), sin DELETE |
| `incidentes` (nueva) | `id`, `evento_id` uuid único, `huella`, `jornada_id`, `parada_id` (opcional), `tipo`, `descripcion` (≤ 300), `reportado_en`, `reportado_por`, `resuelto_en`, `resuelto_por`, `accion`, `version`. Sin DELETE |
| `jornadas` | `version_operacion` (entero; sube con cada evento aplicado y con cada cancelación por incidente). El re-ruteo la compara |
| `planes` | `tipo` (`inicial` \| `re_ruteo`), `plan_base_id`, `restricciones` (jsonb: `{ jornadasNoDisponibles: string[]; admitidas: Record<jornadaId, string[][]>; congeladas: string[] }`). `estado` agrega `reemplazado` |
| `paradas` | `estado` agrega `en_servicio` y `reasignada`. `motivo_no_atendida` (≤ 200). `omitida` ya existe y se usa para la parada que deja de hacerse (pospuesta o cancelada por re-ruteo o incidente) |
| `solicitudes` | Sin cambios de esquema |

`rutas.version` es la versión estructural: solo la cambia un re-ruteo, que retira paradas de esa ruta. Los eventos no la cambian, porque si lo hicieran los encolados sin señal fallarían.

## 3. Contratos

### 3.1 Dominio de la operación (Codex, `src/dominio/operacion/`)

```ts
export type TipoEvento = "check_in" | "salida_patio" | "llegada" | "inicio_servicio" | "fin_servicio" | "no_atendida"
  | "regreso_patio" | "fin_descarga" | "check_out";
export type EstadoParada = "pendiente" | "en_sitio" | "en_servicio" | "completada" | "no_atendida" | "reasignada" | "omitida";

export interface ParadaOperacion { paradaId: string; solicitudId: string; secuencia: number; estado: EstadoParada; vigente: boolean }
export interface ViajeOperacion {
  rutaId: string; numero: number; version: number;
  salidaPatioEn: string | null; regresoPatioEn: string | null; descargaFinEn: string | null;
  odometroInicioKm: number | null; paradas: ParadaOperacion[];          // en secuencia
}
/** Estado de una jornada en todos los planes validados o reemplazados de su fecha, armado con todo bloqueado. */
export interface EstadoJornada {
  jornadaId: string; fecha: string; checkInEn: string | null; checkOutEn: string | null;
  ultimoOcurridoEn: string | null; ultimoOdometroKm: number | null; viajes: ViajeOperacion[]; // en orden de salida planeada
}
export interface EventoEntrada {
  eventoId: string; jornadaId: string; tipo: TipoEvento; ocurridoEn: string;
  rutaId: string | null; paradaId: string | null; versionRuta: number | null; odometroKm: number | null; motivo: string | null;
}
export type Efecto =
  | { tipo: "jornada"; campo: "check_in_en" | "check_out_en" }
  | { tipo: "ruta"; rutaId: string; campo: "salida_patio_en" | "regreso_patio_en" | "descarga_fin_en"; odometroKm?: number }
  | { tipo: "disponibilidad_siguiente"; rutaId: string }                 // el viaje siguiente queda disponible con la descarga real
  | { tipo: "parada"; paradaId: string; estado: EstadoParada; campo: "llegada_en" | "inicio_servicio_en" | "fin_servicio_en" | null; motivo?: string; liberar?: boolean }
  | { tipo: "solicitudes"; rutaId: string; estado: "en_ruta" }
  | { tipo: "solicitud"; paradaId: string; estado: "atendida" | "pendiente_siguiente_dia" };

/** Pura. recibidoEn: hora del servidor. */
export function aplicarEvento(estado: EstadoJornada, evento: EventoEntrada, recibidoEn: string):
  | { ok: true; efectos: Efecto[] } | { ok: false; motivo: string };
export function huellaEvento(evento: EventoEntrada): string;          // canónica: claves ordenadas, sin recibidoEn

/** Frontera del re-ruteo (§4). disponible: si la jornada sigue disponible. ahora: minutos en Ciudad de México. */
export function fronteraDeReruteo(estado: EstadoJornada, disponible: boolean, ahoraMin: number, plan: { viajes: { rutaId: string; finDescargaMin: number; salidaMin: number }[] }):
  | { ok: true; congeladas: string[]; viajeEnCurso: string | null; libreDesdeMin: number; admitidas: string[][]; aReubicar: string[] }
  | { ok: false; motivo: string };                                     // p. ej., jornada no disponible con parada en sitio
```

### 3.2 Motor (Codex): admitidas como restricción

```ts
export interface RestriccionesPlan { admitidas: Record<string, string[][]> }   // por unidad: viajes con solicitudes ya admitidas, en su orden
export function generarPlan(entrada: EntradaPlan, restricciones?: RestriccionesPlan): Plan;
export function ajustarPlan(entrada: EntradaPlan, plan: Plan, ajuste: AjusteManual, restricciones?: RestriccionesPlan): ResultadoAjuste;
export function validarPlan(entrada: EntradaPlan, plan: Plan, opciones?: { ajustadoAMano?: boolean; restricciones?: RestriccionesPlan }): string[];
```

- Las admitidas se admiten antes de la cola FIFO. No se quitan, no cambian de unidad ni de viaje, y conservan su orden relativo. Pueden recibir inserciones.
- Si no son factibles tal cual, `generarPlan` lanza `ErrorAdmitidas`, con la unidad y la causa.
- `ajustarPlan` rechaza mover o posponer una admitida (`entrada_invalida`).
- `validarPlan` comprueba las restricciones de forma independiente; la traza no es su propia autoridad. FIFO solo se exige entre las no admitidas.
- Todas las unidades del re-ruteo empiezan en el patio y sin carga, con `libreDesdeMin` al terminar su viaje en curso. Por eso valen sin cambios `recalcularRuta` y la regla "solo plan inicial" de los ajustes.

### 3.3 Acciones y consultas (Claude)

| Permiso | Roles |
|---|---|
| `ruta.operar` | operador (solo su jornada) |
| `operacion.ver` | despachador, gerencia |
| `operacion.conciliar` | despachador |
| `incidentes.resolver` | despachador |
| re-ruteo | `planes.generar` y `planes.validar` |

```ts
// src/consultas/operador.nucleo.ts — ruta.operar
miRuta(ctx, jornadaId?: unknown): Promise<Resultado<VistaMiRuta>>  // sin jornadaId: la de hoy; con id: una de las últimas 24 h, propia
// src/acciones/operador.nucleo.ts — ruta.operar
registrarEventoOperador(ctx, evento: unknown): Promise<Resultado<{ resultado: "aplicado" | "rechazado"; motivo: string | null; repetido: boolean; estado: EstadoJornada }>>
reportarIncidente(ctx, entrada: unknown /* { eventoId, jornadaId, tipo, descripcion, paradaId? } */): Promise<Resultado<{ id: string; repetido: boolean }>>
// src/acciones/operacion.nucleo.ts
conciliarEvento(ctx, eventoId, entrada /* { nota } */)                      // operacion.conciliar
resolverIncidente(ctx, id, versionEsperada, entrada /* { accion } */)       // incidentes.resolver
generarReruteo(ctx, planBaseId, versionEsperada, entrada /* { jornadasNoDisponibles } */): Promise<Resultado<{ planId: string }>>
// validar el re-ruteo: validarPlanDelDia, con una rama propia para plan.tipo = "re_ruteo" (§4)
// src/consultas/operacion.nucleo.ts — operacion.ver
seguimiento(ctx, fecha): Promise<Resultado<{ porJornada: …; incidentesAbiertos: …; eventosRechazados: … }>>
```

`obtenerPlan(ctx, fecha, planId?)` acepta un plan específico (para revisar una propuesta de re-ruteo junto al validado) y agrega `reruteoPropuesto: { planId } | null` y `congeladas: string[]`.

`CodigoConflicto` agrega `evento_distinto`, `ruta_cambiada` y `operacion_avanzo`.

**Registrar un evento.** En una transacción, en este orden:

1. autorizar con `ruta.operar` y la jornada propia;
2. tomar el candado de la fecha y bloquear la jornada (`FOR UPDATE`);
3. **releer el `evento_id`**: si ya existe con la misma huella, se responde su resultado original; con otra huella, `evento_distinto`;
4. bloquear rutas, paradas y solicitudes de la jornada;
5. `aplicarEvento`:
   - si se aplica, efectos, evento `aplicado`, `version_operacion + 1` y bitácora;
   - si se rechaza, evento `rechazado` con su motivo, sin efectos, y bitácora.

La violación del índice único de un envío simultáneo se traduce fuera de la transacción: el envío vuelve a leer y responde `repetido`.

## 4. Reglas

### Máquina de eventos (`aplicarEvento`)

Es exhaustiva. Cualquier evento que no esté en la tabla se rechaza.

| Evento | Requiere | Efecto |
|---|---|---|
| `check_in` | Sin `check_in` previo | Jornada `check_in_en` |
| `salida_patio` (viaje v) | `check_in`, sin `check_out`, v sin salida, el viaje anterior con `descarga_fin_en`, v con paradas vigentes, odómetro ≥ último | Ruta `salida_patio_en` y odómetro; solicitudes del viaje `en_ruta` |
| `llegada` (parada p) | El viaje de p salió y no regresó; p `pendiente` y vigente; p es la **primera pendiente en secuencia** de su viaje; ninguna otra en sitio o en servicio | p `en_sitio`, `llegada_en` |
| `inicio_servicio` | p `en_sitio` | p `en_servicio`, `inicio_servicio_en` |
| `fin_servicio` | p `en_servicio` | p `completada`, `fin_servicio_en`; solicitud `atendida` |
| `no_atendida` | El viaje salió; p es la primera pendiente o está en sitio; motivo | p `no_atendida`, motivo, `vigente = false`; solicitud `pendiente` para el siguiente día de operación (con una posposición más y su registro original) |
| `regreso_patio` (v) | v salió y no regresó; todas sus paradas cerradas (`completada`, `no_atendida`, `reasignada` u `omitida`); odómetro ≥ el de salida | Ruta `regreso_patio_en` y odómetro |
| `fin_descarga` (v) | v regresó, sin descarga | Ruta `descarga_fin_en`; el viaje siguiente queda con `disponible_para_salir_en` igual a esta hora |
| `check_out` | `check_in`; ningún viaje con salida y sin descarga; ninguna parada vigente pendiente, en sitio o en servicio | Jornada `check_out_en`. Después, nada |

- **Hora.** `ocurrido_en` cae en la fecha de la jornada (Ciudad de México). No es anterior al último evento aplicado de la jornada ni más de 2 minutos posterior a `recibido_en`. El evento se recibe a lo sumo 24 horas después de ocurrir.
- **Vigencia.** Un evento sobre una parada no vigente, o con `version_ruta` distinta de la actual, se rechaza con el motivo "La ruta cambió: llama al despachador".
- **Orden.** El operador sigue la secuencia. Para saltar una parada la marca "No se pudo atender", o el despachador re-rutea. Así, el tramo comprometido es siempre la primera pendiente del viaje en curso, y K1 usa la parada anterior en la secuencia, que es también la anterior en el tiempo.

### Re-ruteo (`generarReruteo`)

1. Se toma el plan base validado de hoy, en su versión, y las `jornadasNoDisponibles`.
2. **Jornadas disponibles**, por `fronteraDeReruteo`:
   - el viaje en curso, si ya salió y no se ha descargado, se congela **completo**, incluidas sus pendientes;
   - `libreDesdeMin` es el fin de descarga planeado de ese viaje más el retraso acumulado (hora real del último evento menos su hora planeada), y nunca antes de ahora. Sin viaje en curso, es ahora;
   - los viajes futuros, que no han salido, pasan como `admitidas`.
3. **Jornadas no disponibles:**
   - se congela solo lo completado y lo no atendido;
   - si tienen una parada en sitio o en servicio, la acción responde `invalido`: el operador debe cerrarla primero;
   - todo lo demás vigente se reubica.
4. **Solicitudes:** las admitidas, las por reubicar y las `lista` de hoy sin parada vigente.
5. `generarPlan(entrada, { admitidas })` con unidades en el patio, sin carga y desde `libreDesdeMin`. Se guarda como `propuesto`, tipo `re_ruteo`, con:
   - `plan_base_id`;
   - `restricciones` (`jornadasNoDisponibles`, `admitidas` y `congeladas`);
   - `versiones`, con la versión del plan base y `version_operacion` de cada jornada.

**Validar un re-ruteo** es una rama propia de `validarPlanDelDia`:

1. **Bloqueos:** los mismos que en el Plan 4, más el plan base y las paradas vigentes del base.
2. **Frescura:**
   - el plan base sigue `validado` y en su versión;
   - ninguna `version_operacion` cambió (`operacion_avanzo`).
3. **Solicitudes:**
   - las ya programadas solo se aceptan si su parada vigente es del plan base y no está congelada;
   - las nuevas deben estar `pendiente`, sin parada vigente y elegibles.
4. **Escrituras**, en este orden:
   1. retirar en el plan base las paradas pendientes no congeladas: `vigente = false`, con estado `reasignada` si quedan ruteadas en el nuevo, u `omitida` si quedan pospuestas;
   2. subir la `version` de las rutas base que pierden paradas;
   3. insertar las rutas y paradas nuevas;
   4. pasar a `programada` las solicitudes nuevas ruteadas, y las pospuestas al siguiente día;
   5. marcar el plan base `reemplazado` y el nuevo `validado`;
   6. bitácora.
5. **Lo que se conserva:** las congeladas siguen vigentes en el plan base, y los viajes en curso no cambian.

### Incidentes

- **Reportar:** idempotente por `evento_id` y huella. Sube `version_operacion`.
- **Resolver con `cancelar`:**
  - solo para una parada vigente `pendiente`;
  - toma el candado de la fecha y bloquea la jornada, como los eventos;
  - cancela la solicitud ("Cancelada por incidente"), deja la parada `omitida` sin vigencia y sube `version_operacion`.
- **Resolver con `re_ruteo`:** solo registra la acción.

### Privacidad

No se captura la ubicación del teléfono, porque K1, K3 y K4 salen de horas y odómetros (minimización). Esto actualiza el texto de la especificación §10. Si se agregara, sería solo en los eventos que marque el operador y con su aviso.

## 5. Pantallas (Codex) y service worker (Claude)

- **`/operador`:**
  - un solo botón principal según el estado, grande, con confirmación para el odómetro y para "No se pudo atender";
  - indicador de conexión y de eventos por enviar, y lista de rechazados ("Llama al despachador");
  - reportar incidente.
  - La cola y la ruta van en `localStorage` con clave `rs-operador:<usuarioId>:<jornadaId>`. Se envían en orden, al volver la señal y cada 30 segundos.
- **Service worker (Claude, `public/sw-operador.js`, alcance `/operador`):**
  - red primero para la navegación de `/operador`, con respaldo en caché;
  - caché para `/_next/static`.
  - Se registra solo en `/operador`. Al cerrar sesión se borran su caché y las claves `rs-operador:` del teléfono.
  - El e2e lo habilita sobre `http://web:3000` con `--unsafely-treat-insecure-origin-as-secure`.
- **Plan del día (despacho)** validado, con sondeo cada 30 segundos:
  - seguimiento por unidad, incidentes abiertos y eventos rechazados por conciliar;
  - **Re-rutear**: elegir jornadas, generar y revisar la propuesta en `?plan=<id>`, con las congeladas en solo lectura;
  - ajustar y validar.

## 6. Qué revisar con más cuidado

- **Idempotencia:** un reintento simultáneo nunca aplica dos veces un evento.
- **Rechazos:** un rechazo nunca se pierde; queda en la base para conciliarse.
- **Lo congelado:** el re-ruteo nunca toca lo congelado ni reordena o cambia de unidad las admitidas. Una validación de re-ruteo con eventos nuevos en medio se rechaza.
- **Sin conexión:** la pantalla abre sin conexión después de recargar.
- **Odómetros:** son monótonos por unidad, y `disponible_para_salir_en` se actualiza con la descarga real.

## 7. Tareas

| # | Responsable | Tarea |
|---|---|---|
| R0a | Codex | Contratos compilables de §3.1 y §3.2 (pendientes solo las funciones nuevas; las firmas ampliadas conservan su comportamiento) |
| R0b | Claude | Migración `0006`, permisos (incluido el `GRANT UPDATE` por columna), códigos de conflicto, firmas de §3.3 pendientes y pruebas de esquema |
| R1 | Codex | `aplicarEvento`, `huellaEvento` y `fronteraDeReruteo`, con propiedades: ninguna secuencia aceptada deja dos paradas en sitio, una completada sin llegada, un odómetro decreciente ni eventos después de `check_out` |
| R2 | Codex | Restricciones `admitidas` en `generarPlan`, `ajustarPlan` y `validarPlan`, con propiedades: conservan unidad, viaje y orden, y FIFO se cumple entre las demás |
| R3 | Claude | Acciones y consultas, rama de validación de re-ruteo y service worker. Pruebas: idempotencia secuencial y simultánea, huella distinta, operador ajeno (también al repetir), rechazos guardados y conciliados, cada efecto, cancelación por incidente contra evento, re-ruteo con avería y con viaje en curso, operación que avanza, y K1, K3 y K4 capturados |
| R4 | Codex | Pantallas de §5 |
| R5 | Codex escribe, Claude ejecuta | e2e de §1.10 en tamaño de teléfono |
| R6 | Ambos | Revisión cruzada y `verificar-todo.sh` sobre el mismo commit |

## 8. Cambios de texto en la especificación (en el commit de este plan)

- **§8 Re-ruteo.** El viaje en curso de cada unidad disponible se congela completo. Las pendientes de las demás unidades disponibles se conservan como restricción (`admitidas`). Se reubican en FIFO las de las jornadas no disponibles y las solicitudes listas nuevas.
- **§10.** En el piloto no se captura la ubicación del operador.

## 9. Respuesta a la revisión de Codex (2026-10-15)

| # | Hallazgo | Decisión |
|---|---|---|
| 1 | Idempotencia antes de autorizar; carrera antes del índice | Autorizar primero; releer `evento_id` con la jornada bloqueada; resultado original guardado (§3.3) |
| 2 | Cola atrasada y rechazos | `jornadaId` en el evento y en la huella; recepción hasta 24 h; rechazos guardados y conciliables; almacenamiento por usuario y jornada que se borra al salir (§1.6, §2) |
| 3 | Máquina incompleta | Tabla exhaustiva con terminalidad, repetidos, `no_atendida` solo con el viaje en curso y `check_out` sin pendientes; `en_servicio` en el enum (§4) |
| 4 | Frontera congelada con orden libre | Orden restringido a la secuencia; las jornadas no disponibles no congelan pendientes; contrato tipado (§3.1, §4) |
| 5 | Carga y continuidad física | No se parten viajes: el viaje en curso se congela completo y las unidades re-ruteadas empiezan en el patio sin carga; sin `continua_ruta_id` (§4) |
| 6 | `admitidas` persistidas | `planes.restricciones` y comprobación independiente en `validarPlan` y `ajustarPlan` (§3.2) |
| 7 | Validación de re-ruteo | Rama propia con reglas para las ya programadas y orden de escrituras (§4) |
| 8 | Incidentes y frescura | `version_operacion` sube con eventos e incidentes; cancelar solo pendientes, con los mismos bloqueos (§4) |
| 9 | Continuaciones e indicadores | Eliminadas al no partir viajes; disponibilidad del viaje siguiente con la descarga real (§4) |
| 10 | Propuesta oculta y carga sin conexión | `obtenerPlan` por `planId`; service worker para `/operador` (§3.3, §5) |
| §8.1 | Parada no atendida | Se libera (`vigente = false`) y la solicitud vuelve a `pendiente` |
| §8.2 | Orden real | Sustituido por orden restringido |
| §8.3 | Solicitudes nuevas en el re-ruteo y GPS | Documentados en §8 de este plan |
